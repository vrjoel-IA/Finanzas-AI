import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServices } from './_load.mjs';

const { expenseReminders } = loadServices();
const {
  occursIn, remindersForPeriod, summarizeReminders,
  markDone, clearDone, skipMonth, rejectMatch, upsertReminder, removeReminder,
  suggestMatches, suggestRemindersForDraft, normalizeText, sharesToken, daysInMonth,
} = expenseReminders;

const HOY = '2026-09-16';

const reminder = (over = {}) => ({
  id: 'r' + Math.random(),
  name: 'Gimnasio',
  amount: 35,
  category: 'Ocio',
  schedule: { kind: 'monthly' },
  startMonth: '2026-01',
  ...over,
});

const tx = (over = {}) => ({
  id: 't' + Math.random(), date: '2026-09-10', amount: 35, description: 'GYM CENTRO',
  category: 'Ocio', type: 'expense', accountId: 'a1', isRefund: false, ...over,
});

const ocurrencias = (reminders, period = '2026-09', today = HOY, knownTxIds) =>
  remindersForPeriod({ reminders, period, today, knownTxIds });

// ---------------------------------------------------------------------------
// Cadencia. Un recordatorio anual que avisara todos los meses seria ruido, y uno
// que no avisara en su mes no serviria para nada.
// ---------------------------------------------------------------------------

test('un recordatorio mensual toca todos los meses desde que empieza', () => {
  const r = reminder({ startMonth: '2026-03' });
  assert.equal(occursIn(r, '2026-02'), false, 'antes de empezar, no');
  assert.equal(occursIn(r, '2026-03'), true);
  assert.equal(occursIn(r, '2026-04'), true);
  assert.equal(occursIn(r, '2027-01'), true);
});

test('uno anual solo toca en su mes', () => {
  const r = reminder({ name: 'Seguro coche', schedule: { kind: 'annual', month: 6, day: 22 }, startMonth: '2026-01' });
  assert.equal(occursIn(r, '2026-06'), true);
  assert.equal(occursIn(r, '2026-07'), false);
  assert.equal(occursIn(r, '2027-06'), true);
});

test('uno trimestral toca cada tres meses desde su mes de anclaje', () => {
  const r = reminder({ schedule: { kind: 'quarterly', anchorMonth: 2 }, startMonth: '2026-01' });
  assert.equal(occursIn(r, '2026-02'), true);
  assert.equal(occursIn(r, '2026-05'), true);
  assert.equal(occursIn(r, '2026-08'), true);
  assert.equal(occursIn(r, '2026-03'), false);
  assert.equal(occursIn(r, '2026-04'), false);
});

test('uno puntual toca solo en el mes de su fecha', () => {
  const r = reminder({ schedule: { kind: 'once', date: '2026-11-04' }, startMonth: '2026-01' });
  assert.equal(occursIn(r, '2026-11'), true);
  assert.equal(occursIn(r, '2026-12'), false);
  assert.equal(occursIn(r, '2027-11'), false, 'puntual es puntual: no vuelve al anio siguiente');
});

test('antes de startMonth y despues de endMonth no avisa', () => {
  const r = reminder({ startMonth: '2026-05', endMonth: '2026-08' });
  assert.equal(occursIn(r, '2026-04'), false);
  assert.equal(occursIn(r, '2026-05'), true);
  assert.equal(occursIn(r, '2026-08'), true);
  assert.equal(occursIn(r, '2026-09'), false);
});

test('un recordatorio archivado deja de avisar sin borrar su historico', () => {
  const r = reminder({ archived: true, done: { '2026-08': { at: '2026-08-10' } } });
  assert.equal(occursIn(r, '2026-09'), false);
  assert.equal(Object.keys(r.done).length, 1, 'lo ya cumplido sigue ahi');
});

test('el dia 31 en un mes de 30 se recorta al ultimo dia', () => {
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
  const r = reminder({ schedule: { kind: 'monthly', day: 31 } });
  assert.equal(ocurrencias([r], '2026-09')[0].dueDate, '2026-09-30');
  assert.equal(ocurrencias([r], '2026-02', '2026-02-01')[0].dueDate, '2026-02-28');
});

test('la vista anual recorre los doce meses', () => {
  const r = reminder({ schedule: { kind: 'quarterly', anchorMonth: 1 }, startMonth: '2026-01' });
  const lista = ocurrencias([r], '2026');
  assert.equal(lista.length, 4, 'enero, abril, julio y octubre');
  assert.equal(lista[0].month, '2026-01');
  assert.equal(lista[3].month, '2026-10');
});

// ---------------------------------------------------------------------------
// Estado y cumplimiento
// ---------------------------------------------------------------------------

test('marcar un periodo como cumplido no toca los demas periodos ni los demas recordatorios', () => {
  const gym = reminder({ id: 'gym' });
  const seguro = reminder({ id: 'seguro', name: 'Seguro', schedule: { kind: 'annual', month: 9 } });
  const antes = JSON.stringify([gym, seguro]);

  const despues = markDone([gym, seguro], 'gym', '2026-09', { txId: 't1', amount: 35, at: HOY });

  assert.equal(JSON.stringify([gym, seguro]), antes, 'la entrada no se muta');
  assert.equal(despues.find(r => r.id === 'gym').done['2026-09'].txId, 't1');
  assert.equal(despues.find(r => r.id === 'gym').done['2026-08'], undefined);
  assert.equal(despues.find(r => r.id === 'seguro').done, undefined, 'el otro recordatorio, intacto');
});

test('marcar y desmarcar deja el recordatorio como estaba', () => {
  const r = reminder({ id: 'gym' });
  const marcado = markDone([r], 'gym', '2026-09', { at: HOY });
  const limpio = clearDone(marcado, 'gym', '2026-09');
  assert.equal(Object.keys(limpio[0].done).length, 0);
  assert.equal(ocurrencias(limpio)[0].state, 'pending');
});

test('este mes no toca oculta el aviso solo en ese mes', () => {
  const r = reminder({ id: 'gym' });
  const saltado = skipMonth([r], 'gym', '2026-09', true);
  assert.equal(ocurrencias(saltado, '2026-09')[0].state, 'skipped');
  assert.equal(ocurrencias(saltado, '2026-10', '2026-10-01')[0].state, 'pending');

  const vuelto = skipMonth(saltado, 'gym', '2026-09', false);
  assert.equal(ocurrencias(vuelto, '2026-09')[0].state, 'pending');
});

test('dar por cumplido un mes saltado deja de saltarlo', () => {
  const r = reminder({ id: 'gym' });
  const saltado = skipMonth([r], 'gym', '2026-09', true);
  const cumplido = markDone(saltado, 'gym', '2026-09', { at: HOY });
  assert.equal(ocurrencias(cumplido)[0].state, 'done');
  assert.equal(cumplido[0].skipped.length, 0);
});

test('si el movimiento enlazado ya no existe se avisa en vez de corregirlo por las bravas', () => {
  const r = markDone([reminder({ id: 'gym' })], 'gym', '2026-09', { txId: 'borrada', at: HOY });
  const conocidas = { otra: true };
  const o = ocurrencias(r, '2026-09', HOY, conocidas)[0];
  assert.equal(o.danglingLink, true);
  assert.equal(o.state, 'done', 'el recordatorio sigue cumplido: decidirlo es del usuario');
});

test('un recordatorio vencido y sin cumplir sale marcado como vencido', () => {
  const r = reminder({ schedule: { kind: 'monthly', day: 5 } });
  const o = ocurrencias([r], '2026-09', HOY)[0];
  assert.equal(o.overdue, true);
  assert.equal(o.daysAway, -11);

  const futuro = reminder({ schedule: { kind: 'monthly', day: 25 } });
  assert.equal(ocurrencias([futuro], '2026-09', HOY)[0].overdue, false);
});

test('el resumen suma pendientes y cumplidos por separado', () => {
  const gym = reminder({ id: 'gym', amount: 35 });
  const padel = reminder({ id: 'padel', name: 'Padel', amount: 45 });
  const seguro = reminder({ id: 'seguro', name: 'Seguro', amount: 320, schedule: { kind: 'annual', month: 9, day: 22 } });

  let lista = [gym, padel, seguro];
  lista = markDone(lista, 'gym', '2026-09', { txId: 't1', amount: 38, at: HOY });
  lista = skipMonth(lista, 'padel', '2026-09', true);

  const resumen = summarizeReminders(ocurrencias(lista));
  assert.equal(resumen.total, 3);
  assert.equal(resumen.pending, 1);
  assert.equal(resumen.done, 1);
  assert.equal(resumen.skipped, 1);
  assert.equal(resumen.pendingAmount, 320);
  assert.equal(resumen.doneAmount, 38, 'lo que de verdad se pago, no lo previsto');
});

test('alta, edicion y borrado de recordatorios', () => {
  const uno = reminder({ id: 'r1' });
  let lista = upsertReminder([], uno);
  assert.equal(lista.length, 1);
  lista = upsertReminder(lista, { ...uno, amount: 40 });
  assert.equal(lista.length, 1, 'el mismo id se actualiza, no se duplica');
  assert.equal(lista[0].amount, 40);
  lista = removeReminder(lista, 'r1');
  assert.equal(lista.length, 0);
});

// ---------------------------------------------------------------------------
// Emparejamiento. Propone; no decide.
// ---------------------------------------------------------------------------

const ocurrenciaDe = (r, month = '2026-09', today = HOY) => ocurrencias([r], month, today)[0];

test('propone el cargo que encaja en categoria, importe y fecha', () => {
  const r = reminder({ name: 'Seguro coche', amount: 320, category: 'Casa', schedule: { kind: 'annual', month: 9, day: 12 } });
  const movimientos = [
    tx({ id: 'ok', amount: 318.4, category: 'Casa', date: '2026-09-12', description: 'SEGUROS XYZ SA' }),
    tx({ id: 'no', amount: 12, category: 'Ocio', date: '2026-09-12', description: 'Cafe' }),
  ];
  const candidatas = suggestMatches({ occurrence: ocurrenciaDe(r), transactions: movimientos });
  assert.equal(candidatas.length, 1);
  assert.equal(candidatas[0].tx.id, 'ok');
  assert.ok(candidatas[0].reasons.indexOf('category') !== -1);
  assert.ok(candidatas[0].reasons.indexOf('amount') !== -1);
});

test('un importe un 10% mayor sigue encajando; uno un 40% mayor no', () => {
  const r = reminder({ amount: 320, category: 'Casa', schedule: { kind: 'annual', month: 9, day: 12 } });
  const cerca = suggestMatches({ occurrence: ocurrenciaDe(r), transactions: [tx({ id: 'a', amount: 352, category: 'Casa', date: '2026-09-12' })] });
  const lejos = suggestMatches({ occurrence: ocurrenciaDe(r), transactions: [tx({ id: 'b', amount: 448, category: 'Casa', date: '2026-09-12' })] });
  assert.equal(cerca.length, 1);
  assert.equal(lejos.length, 0);
});

test('un importe pequeno tiene un margen minimo de cinco euros', () => {
  const r = reminder({ amount: 12, category: 'Ocio', schedule: { kind: 'monthly', day: 10 } });
  const candidatas = suggestMatches({ occurrence: ocurrenciaDe(r), transactions: [tx({ id: 'a', amount: 14, category: 'Ocio', date: '2026-09-10' })] });
  assert.equal(candidatas.length, 1, '2 € sobre 12 € es mas del 15%, pero cabe en el suelo de 5 €');
});

test('un cargo a veinte dias de la fecha esperada no se propone', () => {
  const r = reminder({ name: 'Cuota', amount: 320, category: 'Casa', schedule: { kind: 'annual', month: 9, day: 2 } });
  const candidatas = suggestMatches({
    occurrence: ocurrenciaDe(r),
    transactions: [tx({ id: 'a', amount: 700, category: 'Ropa', date: '2026-09-28', description: 'Otra cosa' })],
  });
  assert.equal(candidatas.length, 0);
});

test('sin importe esperado se empareja por categoria y fecha', () => {
  const r = reminder({ name: 'Revision', amount: undefined, category: 'Casa', schedule: { kind: 'annual', month: 9, day: 12 } });
  const candidatas = suggestMatches({ occurrence: ocurrenciaDe(r), transactions: [tx({ id: 'a', amount: 999, category: 'Casa', date: '2026-09-12' })] });
  assert.equal(candidatas.length, 1);
});

test('no propone aportaciones a huchas, traspasos ni cobros de reembolso', () => {
  const r = reminder({ amount: 100, category: 'Ocio', schedule: { kind: 'monthly', day: 10 } });
  const movimientos = [
    tx({ id: 'hucha', amount: 100, category: 'Ahorro', savingId: 's1', date: '2026-09-10' }),
    tx({ id: 'traspaso', amount: 100, category: 'Traspaso', date: '2026-09-10' }),
    tx({ id: 'cobro', amount: 100, category: 'Ocio', type: 'income', refundId: 'ref1', date: '2026-09-10' }),
  ];
  assert.equal(suggestMatches({ occurrence: ocurrenciaDe(r), transactions: movimientos }).length, 0);
});

test('un movimiento de otro mes no se propone', () => {
  const r = reminder({ amount: 35, category: 'Ocio', schedule: { kind: 'monthly', day: 10 } });
  const candidatas = suggestMatches({ occurrence: ocurrenciaDe(r), transactions: [tx({ id: 'a', date: '2026-08-10' })] });
  assert.equal(candidatas.length, 0);
});

test('un movimiento ya enlazado a otro recordatorio no se vuelve a proponer', () => {
  const r = reminder({ amount: 35, category: 'Ocio', schedule: { kind: 'monthly', day: 10 } });
  const movimientos = [tx({ id: 'usada', date: '2026-09-10' })];
  assert.equal(suggestMatches({ occurrence: ocurrenciaDe(r), transactions: movimientos }).length, 1);
  assert.equal(suggestMatches({ occurrence: ocurrenciaDe(r), transactions: movimientos, usedTxIds: ['usada'] }).length, 0);
});

test('una sugerencia rechazada no vuelve', () => {
  const base = reminder({ id: 'gym', amount: 35, category: 'Ocio', schedule: { kind: 'monthly', day: 10 } });
  const movimientos = [tx({ id: 'nope', date: '2026-09-10' })];
  const tras = rejectMatch([base], 'gym', '2026-09', 'nope');
  const o = ocurrencias(tras)[0];
  assert.equal(suggestMatches({ occurrence: o, transactions: movimientos }).length, 0);
});

test('como mucho tres candidatas, de mejor a peor', () => {
  const r = reminder({ amount: 35, category: 'Ocio', schedule: { kind: 'monthly', day: 10 } });
  const movimientos = [
    tx({ id: 'a', amount: 35, date: '2026-09-10' }),
    tx({ id: 'b', amount: 36, date: '2026-09-11' }),
    tx({ id: 'c', amount: 37, date: '2026-09-12' }),
    tx({ id: 'd', amount: 38, date: '2026-09-13' }),
  ];
  const candidatas = suggestMatches({ occurrence: ocurrenciaDe(r), transactions: movimientos });
  assert.equal(candidatas.length, 3);
  assert.ok(candidatas[0].score >= candidatas[1].score);
  assert.ok(candidatas[1].score >= candidatas[2].score);
});

test('a un recordatorio ya cumplido no se le proponen mas cargos', () => {
  const base = reminder({ id: 'gym', amount: 35, category: 'Ocio', schedule: { kind: 'monthly', day: 10 } });
  const cumplido = markDone([base], 'gym', '2026-09', { at: HOY });
  const o = ocurrencias(cumplido)[0];
  assert.equal(suggestMatches({ occurrence: o, transactions: [tx({ date: '2026-09-10' })] }).length, 0);
});

test('el servicio no decide solo: siempre devuelve candidatas, nunca marca nada', () => {
  const base = reminder({ id: 'gym', amount: 35, category: 'Ocio', schedule: { kind: 'monthly', day: 10 } });
  const lista = [base];
  const antes = JSON.stringify(lista);
  suggestMatches({ occurrence: ocurrencias(lista)[0], transactions: [tx({ date: '2026-09-10' })] });
  assert.equal(JSON.stringify(lista), antes);
  assert.equal(ocurrencias(lista)[0].state, 'pending', 'sigue pendiente hasta que el usuario lo diga');
});

test('normalizar texto y comparar palabras largas', () => {
  assert.equal(normalizeText('Seguro  DEL Coché, S.A.'), 'seguro del coche s a');
  assert.equal(sharesToken('Seguro coche', 'RECIBO SEGURO ANUAL'), true);
  assert.equal(sharesToken('Gym', 'GYM CENTRO'), false, 'palabras de menos de cuatro letras no valen');
  assert.equal(sharesToken('', 'lo que sea'), false);
});

// ---------------------------------------------------------------------------
// El camino inverso: enlazar mientras se da de alta el movimiento.
// ---------------------------------------------------------------------------

test('al dar de alta un gasto que encaja, se ofrece el recordatorio', () => {
  const r = reminder({ id: 'seguro', name: 'Seguro coche', amount: 320, category: 'Casa', schedule: { kind: 'annual', month: 9, day: 12 } });
  const sugerencias = suggestRemindersForDraft([r], {
    amount: 318.4, date: '2026-09-12', category: 'Casa', description: 'SEGUROS XYZ',
  }, HOY);
  assert.equal(sugerencias.length, 1);
  assert.equal(sugerencias[0].reminder.id, 'seguro');
  assert.equal(sugerencias[0].month, '2026-09');
});

test('un gasto que no se parece a nada no ofrece ningun recordatorio', () => {
  const r = reminder({ name: 'Seguro coche', amount: 320, category: 'Casa', schedule: { kind: 'annual', month: 9, day: 12 } });
  assert.equal(suggestRemindersForDraft([r], { amount: 4.2, date: '2026-09-12', category: 'Ocio', description: 'Cafe' }, HOY).length, 0);
});

test('un recordatorio ya cumplido este mes no se vuelve a ofrecer', () => {
  const base = reminder({ id: 'gym', amount: 35, category: 'Ocio', schedule: { kind: 'monthly', day: 10 } });
  const cumplido = markDone([base], 'gym', '2026-09', { at: HOY });
  assert.equal(suggestRemindersForDraft(cumplido, { amount: 35, date: '2026-09-10', category: 'Ocio', description: 'Gym' }, HOY).length, 0);
});

// ---------------------------------------------------------------------------
// REGLA DE ORO. Ninguna operacion de recordatorios puede tocar el historial.
// ---------------------------------------------------------------------------

test('ninguna operacion de recordatorios toca las transacciones ni las cuentas', () => {
  const estado = {
    transactions: [tx({ id: 't1' }), tx({ id: 't2', amount: 320, category: 'Casa' })],
    accounts: [{ id: 'a1', name: 'Banco', initialBalance: 1000, currentBalance: 1500 }],
    expenseReminders: [reminder({ id: 'gym' }), reminder({ id: 'seguro', name: 'Seguro' })],
  };
  const txAntes = JSON.stringify(estado.transactions);
  const cuentasAntes = JSON.stringify(estado.accounts);

  let lista = estado.expenseReminders;
  lista = markDone(lista, 'gym', '2026-09', { txId: 't1', amount: 35, at: HOY });
  lista = clearDone(lista, 'gym', '2026-09');
  lista = skipMonth(lista, 'seguro', '2026-09', true);
  lista = rejectMatch(lista, 'gym', '2026-09', 't2');
  lista = upsertReminder(lista, reminder({ id: 'nuevo', name: 'Padel' }));
  lista = removeReminder(lista, 'seguro');
  remindersForPeriod({ reminders: lista, period: '2026-09', today: HOY });
  summarizeReminders(ocurrencias(lista));

  assert.equal(JSON.stringify(estado.transactions), txAntes, 'las transacciones quedan identicas');
  assert.equal(JSON.stringify(estado.accounts), cuentasAntes, 'y las cuentas tambien');
});

test('los recordatorios no mutan la entrada', () => {
  const lista = [reminder({ id: 'gym' })];
  const antes = JSON.stringify(lista);
  markDone(lista, 'gym', '2026-09', { at: HOY });
  skipMonth(lista, 'gym', '2026-09', true);
  rejectMatch(lista, 'gym', '2026-09', 't1');
  removeReminder(lista, 'gym');
  assert.equal(JSON.stringify(lista), antes);
});

test('aguanta entradas nulas o corruptas', () => {
  assert.equal(ocurrencias(null).length, 0);
  assert.equal(ocurrencias(undefined).length, 0);
  assert.equal(ocurrencias([reminder()], 'manana').length, 0);
  assert.equal(occursIn(null, '2026-09'), false);
  assert.equal(occursIn(reminder({ schedule: null }), '2026-09'), false);
  assert.equal(occursIn(reminder({ startMonth: 'basura' }), '2026-09'), false);
  assert.equal(markDone(null, 'x', '2026-09', { at: HOY }).length, 0);
  assert.equal(summarizeReminders(null).total, 0);
  assert.equal(suggestMatches({ occurrence: null, transactions: [] }).length, 0);
  assert.equal(suggestRemindersForDraft(null, { amount: 1, date: '2026-09-01', category: '', description: '' }, HOY).length, 0);
});
