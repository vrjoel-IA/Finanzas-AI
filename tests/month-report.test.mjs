import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServices } from './_load.mjs';

const { periodIndex, monthReport } = loadServices();
const { buildPeriodIndex } = periodIndex;
const { buildMonthReport, compareLabel, daysInMonth } = monthReport;

const tx = (over = {}) => ({
  id: 't' + Math.random(), date: '2026-09-10', amount: 100, description: 'x',
  category: 'Ocio', type: 'expense', accountId: 'a1', isRefund: false, ...over,
});
const budget = (over = {}) => ({
  id: 'b' + Math.random(), category: 'Ocio', limit: 100, icon: 'Coffee',
  spent: 0, type: 'expense', color: '#000', period: '2026-09', ...over,
});

const report = (transactions, budgets, period, today, savings = []) =>
  buildMonthReport({ period, today, budgets, index: buildPeriodIndex(transactions), savings });

test('el tipo de informe depende de si el mes esta en curso, cerrado o por llegar', () => {
  assert.equal(report([], [], '2026-09', '2026-09-13').kind, 'progress');
  assert.equal(report([], [], '2026-08', '2026-09-13').kind, 'summary');
  assert.equal(report([], [], '2026-10', '2026-09-13').kind, 'future');
  assert.equal(report([], [], '2025', '2026-09-13').kind, 'summary');
  assert.equal(report([], [], '2026', '2026-09-13').kind, 'progress');
});

test('el ritmo es el dia entre los dias del mes', () => {
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2026-09'), 30);
  const r = report([], [], '2026-09', '2026-09-15');
  assert.equal(r.pace, 0.5);
});

test('pasado, al limite y a este ritmo te pasaras, por orden de gravedad', () => {
  const transactions = [
    tx({ date: '2026-09-02', amount: 130, category: 'Ocio' }),        // 130 de 100: pasado
    tx({ date: '2026-09-03', amount: 90, category: 'Ropa' }),         // 90 de 100: al limite
    tx({ date: '2026-09-04', amount: 60, category: 'Transporte' }),   // 60 de 100 a mitad de mes: 120 previsto
    tx({ date: '2026-09-05', amount: 10, category: 'Casa' }),         // tranquilo
  ];
  const budgets = ['Ocio', 'Ropa', 'Transporte', 'Casa'].map(category => budget({ category }));
  const r = report(transactions, budgets, '2026-09', '2026-09-15');
  assert.equal(r.watch.map(w => w.category + ':' + w.status).join(', '), 'Ocio:over, Ropa:at-risk, Transporte:projected');
  assert.equal(r.overCount, 1);
});

test('la proyeccion no se usa al principio de mes ni en un mes cerrado', () => {
  const transactions = [tx({ date: '2026-09-02', amount: 60, category: 'Transporte' })];
  const budgets = [budget({ category: 'Transporte' })];
  assert.equal(report(transactions, budgets, '2026-09', '2026-09-05').watch.length, 0, 'el dia 5 es pronto');
  assert.equal(report(transactions, budgets, '2026-09', '2026-10-01').watch.length, 0, 'mes cerrado');
});

test('como mucho tres avisos', () => {
  const categories = ['A', 'B', 'C', 'D', 'E'];
  const transactions = categories.map(category => tx({ category, amount: 200 }));
  const budgets = categories.map(category => budget({ category }));
  assert.equal(report(transactions, budgets, '2026-09', '2026-09-20').watch.length, 3);
});

test('un presupuesto sin limite no provoca division por cero', () => {
  const r = report([tx({ category: 'Ocio', amount: 0 })], [budget({ limit: 0 })], '2026-09', '2026-09-20');
  assert.equal(r.watch.length, 0);
  for (const line of r.lines) assert.doesNotMatch(line, /NaN|Infinity/);
});

test('un mes sin movimientos lo dice en vez de inventar cifras', () => {
  const r = report([], [budget()], '2026-09', '2026-09-20');
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /movimientos/);
});

test('el resumen de un mes cerrado cuenta excedidos, ingresos, ahorro y el punto ciego', () => {
  const transactions = [
    tx({ date: '2026-08-01', amount: 2000, type: 'income', category: 'Nomina' }),
    tx({ date: '2026-08-02', amount: 150, category: 'Ocio' }),
    tx({ date: '2026-08-03', amount: 400, category: 'Viajes' }),
    tx({ date: '2026-08-04', amount: 300, category: 'Ahorro', savingId: 's1' }),
  ];
  const budgets = [
    budget({ category: 'Ocio', period: '2026-08' }),
    budget({ category: 'Nomina', type: 'income', limit: 2000, period: '2026-08' }),
    budget({ category: 'Viaje', type: 'saving', savingId: 's1', limit: 250, period: '2026-08' }),
  ];
  const r = report(transactions, budgets, '2026-08', '2026-09-13', [{ id: 's1', name: 'Viaje' }]);
  assert.equal(r.kind, 'summary');
  assert.equal(r.overCount, 1);
  assert.equal(r.incomeGoal.met, true);
  assert.equal(r.savingGoals.total, 1);
  assert.equal(r.savingGoals.met, 1);
  assert.equal(r.unbudgeted.category, 'Viajes');
  assert.equal(r.headline.saving, 300, 'ahorro = dinero movido a huchas');
  const text = r.lines.join(' ');
  assert.match(text, /te pasaste en 1 presupuesto/);
  assert.match(text, /Viajes/);
});

test('un objetivo de una hucha borrada no cuenta', () => {
  const budgets = [budget({ category: 'Vieja', type: 'saving', savingId: 'borrada', limit: 100 })];
  const r = report([tx()], budgets, '2026-09', '2026-09-20', []);
  assert.equal(r.savingGoals.total, 0);
});

test('construir el informe no toca las entradas', () => {
  const transactions = [tx()];
  const budgets = [budget()];
  const before = JSON.stringify([transactions, budgets]);
  report(transactions, budgets, '2026-09', '2026-09-20');
  assert.equal(JSON.stringify([transactions, budgets]), before);
});

// ---------------------------------------------------------------------------
// Etiqueta del periodo comparado. La comparativa decia "Entonces: 1.100 €", que
// no nombra ningun periodo y obliga a subir la vista hasta la cabecera.
// ---------------------------------------------------------------------------

test('el periodo comparado se nombra sin repetir el anio cuando es el mismo', () => {
  assert.equal(compareLabel('2026-08', '2026-09'), 'Agosto');
});

test('comparando con hace un anio, el anio si aparece', () => {
  assert.equal(compareLabel('2025-09', '2026-09'), 'Septiembre 2025');
});

test('diciembre contra enero del anio siguiente lleva anio', () => {
  assert.equal(compareLabel('2025-12', '2026-01'), 'Diciembre 2025');
});

test('en vista anual la etiqueta es el propio anio', () => {
  assert.equal(compareLabel('2025', '2026'), '2025');
});

test('una clave que no es un periodo se devuelve tal cual en vez de romper', () => {
  assert.equal(compareLabel('', '2026-09'), '');
  assert.equal(compareLabel('2026-13', '2026-09'), '2026-13');
  assert.equal(compareLabel('manana', '2026-09'), 'manana');
});

// ---------------------------------------------------------------------------
// Lo que viene. Entra ya resumido para no acoplar el informe a los
// recordatorios, y siempre dicho como prevision: si la IA que redacta encima lo
// leyera como gasto ya hecho, aconsejaria sobre un mes que no existe.
// ---------------------------------------------------------------------------

const reportCon = (upcoming, period = '2026-09', today = '2026-09-13') =>
  buildMonthReport({ period, today, budgets: [budget()], index: buildPeriodIndex([tx()]), savings: [], upcoming });

test('el informe dice lo que viene sin contarlo como gasto', () => {
  const r = reportCon({ pending: 3, amount: 540, overdue: 0 });
  const texto = r.lines.join(' ');
  assert.match(texto, /540€ en 3 recordatorios/);
  assert.match(texto, /no están contados en el gasto de arriba/);
});

test('un recordatorio vencido se dice aparte', () => {
  assert.match(reportCon({ pending: 2, amount: 100, overdue: 1 }).lines.join(' '), /Uno de ellos ya debería haber pasado/);
  assert.match(reportCon({ pending: 3, amount: 100, overdue: 2 }).lines.join(' '), /2 de ellos ya deberían haber pasado/);
});

test('un mes que aun no ha empezado tambien avisa de lo que viene', () => {
  const r = reportCon({ pending: 1, amount: 320, overdue: 0 }, '2026-11', '2026-09-13');
  assert.equal(r.kind, 'future');
  assert.match(r.lines.join(' '), /320€ en 1 recordatorio/);
});

test('sin recordatorios el informe es exactamente el de antes', () => {
  const sin = report([tx()], [budget()], '2026-09', '2026-09-13');
  const conCero = reportCon({ pending: 0, amount: 0, overdue: 0 });
  assert.equal(sin.upcoming, null);
  assert.equal(JSON.stringify(sin.lines), JSON.stringify(conCero.lines));
});
