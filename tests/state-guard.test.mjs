import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './_load.mjs';

const { checkDestructiveWrite, summarize, looksLikeSeedState } = loadModule('../services/stateGuard.ts');

const tx = n => Array.from({ length: n }, (_, i) => ({ id: 't' + i, amount: 10, type: 'expense', date: '2026-09-01', category: 'Ocio', description: 'x', accountId: 'a1', isRefund: false }));

const estado = (over = {}) => ({
  transactions: tx(300),
  accounts: [{ id: 'a1' }, { id: 'a2' }],
  savings: [{ id: 's1' }, { id: 's2' }],
  budgets: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }],
  refunds: [{ id: 'r1' }],
  ...over,
});

// El estado exacto que sobrescribio el historial del usuario el 13/09/2026.
const semilla = {
  transactions: [],
  accounts: [{ id: 'acc1', name: 'Banco Principal' }, { id: 'acc2', name: 'Efectivo' }],
  savings: [{ id: 'sav1' }, { id: 'sav2' }],
  budgets: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }],
  refunds: [],
};

// ---------------------------------------------------------------------------
// El caso real
// ---------------------------------------------------------------------------

test('el guardado que borro el historial habria sido bloqueado', () => {
  const veredicto = checkDestructiveWrite(estado(), semilla);
  assert.equal(veredicto.destructive, true);
  assert.match(veredicto.reason, /todas las transacciones \(300\)/);
  assert.equal(veredicto.before.transactions, 300);
  assert.equal(veredicto.after.transactions, 0);
});

test('reconoce el estado semilla', () => {
  assert.equal(looksLikeSeedState(semilla), true);
  assert.equal(looksLikeSeedState(estado()), false);
});

// ---------------------------------------------------------------------------
// Lo que NO debe bloquear, que importa igual: una guardia que molesta se acaba
// desactivando, y entonces no protege de nada.
// ---------------------------------------------------------------------------

test('el primer guardado nunca se bloquea', () => {
  assert.equal(checkDestructiveWrite(null, estado()).destructive, false);
  assert.equal(checkDestructiveWrite(undefined, semilla).destructive, false);
});

test('anadir datos no es destructivo', () => {
  const antes = estado();
  const despues = estado({ transactions: tx(320) });
  assert.equal(checkDestructiveWrite(antes, despues).destructive, false);
});

test('borrar unas pocas transacciones a mano no se bloquea', () => {
  const antes = estado();
  const despues = estado({ transactions: tx(295) });
  assert.equal(checkDestructiveWrite(antes, despues).destructive, false);
});

test('cambiar de mes, de tema o de orden no es destructivo', () => {
  const antes = estado();
  const despues = { ...estado(), currentDate: '2026-01', theme: 'dark', dashboardLayout: ['budget'] };
  assert.equal(checkDestructiveWrite(antes, despues).destructive, false);
});

test('partir de vacio y seguir vacio no se bloquea', () => {
  const vacio = { transactions: [], accounts: [], savings: [], budgets: [], refunds: [] };
  assert.equal(checkDestructiveWrite(vacio, vacio).destructive, false);
});

// ---------------------------------------------------------------------------
// Umbrales
// ---------------------------------------------------------------------------

test('perder mas de la mitad se bloquea; justo la mitad no', () => {
  const antes = estado({ transactions: tx(100) });
  assert.equal(checkDestructiveWrite(antes, estado({ transactions: tx(49) })).destructive, true);
  assert.equal(checkDestructiveWrite(antes, estado({ transactions: tx(50) })).destructive, false);
});

test('tambien protege cuentas, huchas, presupuestos y reembolsos', () => {
  const antes = estado();
  assert.match(checkDestructiveWrite(antes, estado({ accounts: [] })).reason, /cuentas/);
  assert.match(checkDestructiveWrite(antes, estado({ savings: [] })).reason, /huchas/);
  assert.match(checkDestructiveWrite(antes, estado({ budgets: [] })).reason, /presupuestos/);
  assert.match(checkDestructiveWrite(antes, estado({ refunds: [] })).reason, /reembolsos/);
});

test('acumula varias perdidas en un solo mensaje', () => {
  const veredicto = checkDestructiveWrite(estado(), { transactions: [], accounts: [], savings: [], budgets: [], refunds: [] });
  assert.match(veredicto.reason, /transacciones/);
  assert.match(veredicto.reason, /cuentas/);
});

// ---------------------------------------------------------------------------
// Robustez: la guardia no puede ser la que rompa la app
// ---------------------------------------------------------------------------

test('aguanta estados corruptos o incompletos sin lanzar', () => {
  assert.equal(checkDestructiveWrite({}, {}).destructive, false);
  assert.equal(checkDestructiveWrite({ transactions: null }, { transactions: 'no soy un array' }).destructive, false);
  assert.equal(summarize(null).transactions, 0);
  assert.equal(summarize(undefined).accounts, 0);
});

test('no muta ninguno de los dos estados', () => {
  const antes = estado();
  const despues = semilla;
  const copiaAntes = JSON.stringify(antes);
  const copiaDespues = JSON.stringify(despues);
  checkDestructiveWrite(antes, despues);
  assert.equal(JSON.stringify(antes), copiaAntes);
  assert.equal(JSON.stringify(despues), copiaDespues);
});
