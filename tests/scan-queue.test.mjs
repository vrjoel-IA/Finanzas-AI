import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServices } from './_load.mjs';

const { scanQueue } = loadServices();
const {
  buildSlots, singleSlot, emptyDraft, draftFromScan, draftFromTx,
  updateDraft, markStatus, findSlot, nextPendingId, prevPendingId, countByStatus,
  normalizeScanDate, matchAccount, matchCategory, payloadFromDraft,
} = scanQueue;

const HOY = '2026-09-16';

const ctx = (over = {}) => ({
  accounts: [{ id: 'a1', name: 'Banco Principal' }, { id: 'a2', name: 'Revolut' }],
  budgets: [{ category: 'Ocio', type: 'expense' }, { category: 'Comida', type: 'expense' }],
  today: HOY,
  ...over,
});

const scan = (over = {}) => ({
  description: 'Cena', amount: 42, date: '2026-09-10', category: 'Ocio',
  type: 'expense', isTransfer: false, isSaving: false, isRefund: false, ...over,
});

const nombreCuenta = id => (ctx().accounts.find(a => a.id === id) || {}).name || '';

// ---------------------------------------------------------------------------
// El arrastre entre movimientos. Con la cola antigua, loadScannedItem no
// reseteaba la deuda, la hucha, el reparto ni la cuenta destino: el movimiento
// siguiente heredaba en silencio lo que hubieras elegido en el anterior.
// ---------------------------------------------------------------------------

test('el borrador de un item no arrastra la deuda, la hucha ni el reparto del anterior', () => {
  const slots = buildSlots([scan(), scan({ description: 'Gym' })], ctx());
  const sucio = updateDraft(slots, 'scan_0', {
    selectedRefundId: 'ref_1', selectedSavingId: 'sav_1', myPartManual: 20, transferTargetId: 'a2',
  });

  const segundo = findSlot(sucio, 'scan_1').draft;
  assert.equal(segundo.selectedRefundId, '');
  assert.equal(segundo.selectedSavingId, '');
  assert.equal(segundo.myPartManual, '');
  assert.equal(segundo.transferTargetId, '');
});

test('editar un borrador no toca a los demas ni al original que extrajo Aura', () => {
  const items = [scan(), scan({ description: 'Gym' })];
  const antes = JSON.stringify(items);
  const slots = buildSlots(items, ctx());
  const despues = updateDraft(slots, 'scan_0', { desc: 'Cena con Ana' });

  assert.equal(findSlot(despues, 'scan_0').draft.desc, 'Cena con Ana');
  assert.equal(findSlot(despues, 'scan_1').draft.desc, 'Gym');
  assert.equal(findSlot(slots, 'scan_0').draft.desc, 'Cena', 'el array original no se muta');
  assert.equal(JSON.stringify(items), antes, 'lo que leyo Aura queda intacto');
});

// ---------------------------------------------------------------------------
// El anio de los tickets. Se estampaba el anio en curso a lo bruto.
// ---------------------------------------------------------------------------

test('un ticket de diciembre escaneado en enero no salta once meses al futuro', () => {
  assert.equal(normalizeScanDate('2027-12-20', '2027-01-05'), '2026-12-20');
});

test('una fecha reciente se respeta tal cual', () => {
  assert.equal(normalizeScanDate('2026-09-10', HOY), '2026-09-10');
  assert.equal(normalizeScanDate('2026-08-31', HOY), '2026-08-31');
});

test('una compra de pasado manana sigue siendo de pasado manana', () => {
  assert.equal(normalizeScanDate('2026-09-18', HOY), '2026-09-18');
});

test('una fecha absurda o vacia cae en hoy en vez de romper', () => {
  assert.equal(normalizeScanDate('', HOY), HOY);
  assert.equal(normalizeScanDate('manana', HOY), HOY);
  assert.equal(normalizeScanDate('2026-13-40', HOY), HOY);
});

// ---------------------------------------------------------------------------
// Emparejamientos
// ---------------------------------------------------------------------------

test('la cuenta que sugiere Aura se empareja con la del usuario', () => {
  const cuentas = ctx().accounts;
  assert.equal(matchAccount('REVOLUT', cuentas), 'a2');
  assert.equal(matchAccount('Banco Principal', cuentas), 'a1');
  assert.equal(matchAccount('Banco Inventado', cuentas), null);
  assert.equal(matchAccount(undefined, cuentas), null);
});

test('una categoria que no existe en los presupuestos se conserva tal cual', () => {
  const presupuestos = ctx().budgets;
  assert.equal(matchCategory('ocio', presupuestos), 'Ocio', 'se normaliza a la del presupuesto');
  assert.equal(matchCategory('Gasolina', presupuestos), 'Gasolina', 'sin presupuesto, se respeta lo leido');
  assert.equal(matchCategory('', presupuestos), '');
});

test('una hucha no se cuela como categoria de gasto', () => {
  const presupuestos = [{ category: 'Viaje', type: 'saving' }, { category: 'Ocio', type: 'expense' }];
  assert.equal(matchCategory('Viaje', presupuestos), 'Viaje', 'no encaja con el objetivo de hucha, se queda crudo');
});

// ---------------------------------------------------------------------------
// Navegacion. Lo que pidio el usuario: moverse entre las pendientes y que las
// confirmadas desaparezcan.
// ---------------------------------------------------------------------------

test('confirmar un item lo saca de los pendientes sin mover a los demas', () => {
  const slots = buildSlots([scan(), scan(), scan()], ctx());
  const tras = markStatus(slots, 'scan_1', 'confirmed');

  assert.equal(tras.length, 3, 'la lista no encoge: los indices no se mueven');
  assert.equal(tras[1].id, 'scan_1');
  const cuenta = countByStatus(tras);
  assert.equal(cuenta.pending, 2);
  assert.equal(cuenta.confirmed, 1);
  assert.equal(cuenta.total, 3);
});

test('siguiente pendiente da la vuelta y salta los confirmados', () => {
  const slots = markStatus(buildSlots([scan(), scan(), scan()], ctx()), 'scan_1', 'confirmed');
  assert.equal(nextPendingId(slots, 'scan_0'), 'scan_2', 'se salta el confirmado');
  assert.equal(nextPendingId(slots, 'scan_2'), 'scan_0', 'y da la vuelta');
  assert.equal(prevPendingId(slots, 'scan_0'), 'scan_2');
});

test('cuando solo queda uno pendiente no hay a donde ir', () => {
  let slots = buildSlots([scan(), scan()], ctx());
  slots = markStatus(slots, 'scan_1', 'discarded');
  assert.equal(nextPendingId(slots, 'scan_0'), null);
});

test('al confirmar el que se estaba viendo, el cursor encuentra otro pendiente', () => {
  const slots = markStatus(buildSlots([scan(), scan()], ctx()), 'scan_0', 'confirmed');
  assert.equal(nextPendingId(slots, 'scan_0'), 'scan_1', 'desde un hueco que ya no esta pendiente, al primero que lo este');
});

// ---------------------------------------------------------------------------
// El payload. Esta es la unica pieza que decide QUE se escribe, asi que es la
// que no puede equivocarse.
// ---------------------------------------------------------------------------

test('un gasto normal se escribe tal cual, sin deuda ni hucha', () => {
  const slots = buildSlots([scan()], ctx());
  const payload = payloadFromDraft(findSlot(slots, 'scan_0').draft, nombreCuenta);
  assert.equal(payload.kind, 'single');
  assert.equal(payload.tx.type, 'expense');
  assert.equal(payload.tx.amount, 42);
  assert.equal(payload.tx.category, 'Ocio');
  assert.equal(payload.tx.isRefund, false);
  assert.equal(payload.tx.refundId, undefined);
  assert.equal(payload.tx.savingId, undefined);
  assert.equal(payload.myPart, undefined);
});

test('el payload de una aportacion a hucha es un gasto con categoria Ahorro', () => {
  const draft = { ...emptyDraft(ctx()), amount: 100, type: 'saving', savingDirection: 'deposit', selectedSavingId: 'sav_1' };
  const payload = payloadFromDraft(draft, nombreCuenta);
  assert.equal(payload.tx.type, 'expense');
  assert.equal(payload.tx.category, 'Ahorro');
  assert.equal(payload.tx.savingId, 'sav_1');
});

test('el payload de una retirada de hucha es un ingreso', () => {
  const draft = { ...emptyDraft(ctx()), amount: 100, type: 'saving', savingDirection: 'withdraw', selectedSavingId: 'sav_1' };
  const payload = payloadFromDraft(draft, nombreCuenta);
  assert.equal(payload.tx.type, 'income');
  assert.equal(payload.tx.category, 'Ahorro');
});

test('el payload de un gasto marcado como reembolso conserva isRefund y tu parte', () => {
  const draft = { ...emptyDraft(ctx()), amount: 180, category: 'Ocio', isRefundLink: true, myPartManual: 60 };
  const payload = payloadFromDraft(draft, nombreCuenta);
  assert.equal(payload.tx.isRefund, true);
  assert.equal(payload.tx.refundId, undefined, 'el gasto genera la deuda, no se enlaza a una existente');
  assert.equal(payload.myPart, 60);
});

test('sin indicar tu parte, se reparte la mitad', () => {
  const draft = { ...emptyDraft(ctx()), amount: 180, isRefundLink: true, myPartManual: '' };
  assert.equal(payloadFromDraft(draft, nombreCuenta).myPart, 90);
});

test('un ingreso enlazado a una deuda lleva refundId y no reparte nada', () => {
  const draft = { ...emptyDraft(ctx()), amount: 60, type: 'income', isRefundLink: true, selectedRefundId: 'ref_1' };
  const payload = payloadFromDraft(draft, nombreCuenta);
  assert.equal(payload.tx.type, 'income');
  assert.equal(payload.tx.refundId, 'ref_1');
  assert.equal(payload.myPart, undefined);
});

test('un traspaso son dos movimientos con la misma fecha e importe y cuentas cruzadas', () => {
  const draft = { ...emptyDraft(ctx()), amount: 250, date: '2026-09-14', isTransfer: true, accountId: 'a1', transferTargetId: 'a2' };
  const payload = payloadFromDraft(draft, nombreCuenta);

  assert.equal(payload.kind, 'transfer');
  assert.equal(payload.out.amount, payload.in.amount);
  assert.equal(payload.out.date, payload.in.date);
  assert.equal(payload.out.accountId, 'a1');
  assert.equal(payload.in.accountId, 'a2');
  assert.equal(payload.out.type, 'expense');
  assert.equal(payload.in.type, 'income');
  assert.equal(payload.out.category, 'Traspaso');
  assert.equal(payload.out.description, 'Transferencia a Revolut');
  assert.equal(payload.in.description, 'Transferencia desde Banco Principal');
});

test('sin importe no se escribe nada', () => {
  assert.equal(payloadFromDraft(emptyDraft(ctx()), nombreCuenta), null);
});

// ---------------------------------------------------------------------------
// Regla de oro: este modulo no puede crear ni tocar ningun movimiento. Solo
// describe lo que se escribiria si el usuario confirmase.
// ---------------------------------------------------------------------------

test('recorrer la cola entera no produce ninguna transaccion por si sola', () => {
  const items = [scan(), scan({ isSaving: true }), scan({ isTransfer: true })];
  const antes = JSON.stringify(items);
  let slots = buildSlots(items, ctx());

  let cursor = 'scan_0';
  for (let i = 0; i < 6; i++) {
    slots = updateDraft(slots, cursor, { desc: 'toqueteado ' + i });
    const siguiente = nextPendingId(slots, cursor);
    if (!siguiente) break;
    cursor = siguiente;
  }

  assert.equal(JSON.stringify(items), antes, 'lo que extrajo Aura no se toca');
  assert.equal(countByStatus(slots).confirmed, 0, 'navegar no confirma nada');
});

test('el alta manual usa el mismo camino con un solo hueco', () => {
  const slots = singleSlot(emptyDraft(ctx()));
  assert.equal(slots.length, 1);
  assert.equal(slots[0].source, null);
  assert.equal(nextPendingId(slots, 'single'), null, 'no hay a donde navegar');
});

test('editar un movimiento existente lo carga entero, hucha y deuda incluidas', () => {
  const tx = {
    id: 'tx_1', date: '2026-09-01', amount: 30, description: 'Bizum Ana', category: 'Ocio',
    type: 'income', accountId: 'a2', isRefund: false, refundId: 'ref_9',
  };
  const draft = draftFromTx(tx, ctx());
  assert.equal(draft.desc, 'Bizum Ana');
  assert.equal(draft.type, 'income');
  assert.equal(draft.isRefundLink, true);
  assert.equal(draft.selectedRefundId, 'ref_9');
  assert.equal(draft.accountId, 'a2');
});

test('lo que Aura lee como retirada de hucha llega con la direccion correcta', () => {
  const draft = draftFromScan(scan({ isSaving: true, type: 'income' }), ctx());
  assert.equal(draft.type, 'saving');
  assert.equal(draft.savingDirection, 'withdraw');
});

test('aguanta entradas corruptas sin lanzar', () => {
  // Los arrays nacidos dentro del vm tienen otro prototipo, asi que se compara
  // el contenido y no la identidad.
  assert.equal(buildSlots(null, ctx()).length, 0);
  assert.equal(buildSlots(undefined, ctx()).length, 0);
  const draft = draftFromScan({}, ctx());
  assert.equal(draft.desc, '');
  assert.equal(draft.date, HOY);
  assert.equal(countByStatus([]).pending, 0);
});
