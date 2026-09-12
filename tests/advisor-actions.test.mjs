import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(relativePath, modules = {}) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require(n) {
    if (Object.hasOwn(modules, n)) return modules[n];
    throw new Error(`Forbidden dependency: ${n}`);
  }, console, Math, Number, JSON, Date, Object, Array, Set, Map }, { filename: relativePath });
  return exports;
}
const refunds = load('../services/refunds.ts');
const A = load('../components/advisorActions.ts', { '../services/refunds': refunds });
const ctx = load('../components/advisorContext.ts');

const state = () => ({
  accounts: [{ id: 'a1', name: 'Banco', type: 'Bank', initialBalance: 500, currentBalance: 500, color: 'b' }],
  savings: [{ id: 's1', name: 'Viaje', currentAmount: 300, targetAmount: 1000, isInvestment: false, color: 'b' }],
  budgets: [{ id: 'b1', category: 'Ocio', limit: 100, period: '2026-09', type: 'expense', color: 'b', icon: 'x', spent: 20 }],
  transactions: [{ id: 't1', amount: 20, type: 'expense', accountId: 'a1', date: '2026-09-01', category: 'Ocio', description: 'Cine', isRefund: false }],
  refunds: [], challenges: [], currentDate: '2026-09', viewMode: 'month',
});
const openRefund = { id: 'r1', name: 'Cena', totalAmount: 100, paidByMe: 40, pendingAmount: 60, status: 'open', notes: '', date: '2026-09-01', category: 'Ocio' };
const prep = (name, args, s = state()) => A.prepareAdvisorProposal(name, args, s, 1, '2026-09-12');

test('la navegacion no necesita confirmacion; todo lo que toca datos si', () => {
  for (const [name, args] of [['goToPeriod', { month: '2026-10' }], ['setViewMode', { mode: 'year' }], ['toggleTheme', {}]]) {
    assert.equal(A.needsConfirmation(prep(name, args)), false, name);
  }
  for (const [name, args] of [
    ['createBudgetCategory', { categoryName: 'Transporte', limit: 50, type: 'expense' }],
    ['deleteBudgetCategory', { categoryName: 'Ocio' }],
    ['createSavingsGoal', { name: 'Coche' }],
    ['renameAccount', { currentName: 'Banco', newName: 'BBVA' }],
  ]) {
    assert.equal(A.needsConfirmation(prep(name, args)), true, name);
  }
});

test('los borrados se marcan como destructivos y las altas no', () => {
  assert.equal(prep('deleteBudgetCategory', { categoryName: 'Ocio' }).tier, 'destructive');
  assert.equal(prep('deleteExistingTransaction', { description: 'Cine' }).tier, 'destructive');
  assert.equal(prep('deleteSavingsGoal', { name: 'Viaje' }).tier, 'destructive');
  assert.equal(prep('createBudgetCategory', { categoryName: 'Transporte', limit: 50, type: 'expense' }).tier, 'write');
  assert.equal(prep('createSavingsGoal', { name: 'Coche' }).tier, 'write');
});

test('ninguna preparacion modifica el estado recibido', () => {
  const s = state();
  const before = JSON.stringify(s);
  const calls = [
    ['goToPeriod', { month: '2026-10' }],
    ['createBudgetCategory', { categoryName: 'Transporte', limit: 50, type: 'expense' }],
    ['updateExistingBudgetLimit', { categoryName: 'Ocio', newLimit: 150 }],
    ['deleteBudgetCategory', { categoryName: 'Ocio' }],
    ['recordNewTransaction', { description: 'Gasolina', amount: 40, category: 'Transporte', type: 'expense', accountName: 'Banco' }],
    ['updateExistingTransaction', { description: 'Cine', newAmount: 25 }],
    ['deleteExistingTransaction', { description: 'Cine' }],
    ['createSavingsGoal', { name: 'Coche', targetAmount: 5000 }],
    ['updateSavingsGoal', { name: 'Viaje', newTargetAmount: 2000 }],
    ['deleteSavingsGoal', { name: 'Viaje' }],
    ['createAccount', { name: 'Revolut', type: 'Card', initialBalance: 0 }],
    ['renameAccount', { currentName: 'Banco', newName: 'BBVA' }],
  ];
  for (const [name, args] of calls) prep(name, args, s);
  assert.equal(JSON.stringify(s), before);
});

test('renombrar una cuenta conserva saldo e id, y no toca transacciones', () => {
  const s = state();
  const p = prep('renameAccount', { currentName: 'Banco', newName: 'BBVA' }, s);
  assert.equal(JSON.stringify(p.value), JSON.stringify({ ...s.accounts[0], name: 'BBVA' }));
  const writes = [];
  A.applyAdvisorProposal(p, s, { updateAccount: v => writes.push(v) });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].currentBalance, 500);
  assert.equal(writes[0].id, 'a1');
  assert.equal(JSON.stringify(s.transactions), JSON.stringify(state().transactions));
});

test('cambiar el objetivo de una hucha no toca el saldo acumulado', () => {
  const p = prep('updateSavingsGoal', { name: 'Viaje', newTargetAmount: 2000 });
  assert.equal(p.value.currentAmount, 300);
  assert.equal(p.value.targetAmount, 2000);
});

test('no se propone nada ambiguo, duplicado ni vacio', () => {
  const s = state();
  assert.throws(() => prep('renameAccount', { currentName: 'Inexistente', newName: 'X' }, s), /inequívoca/);
  assert.throws(() => prep('createSavingsGoal', { name: 'Viaje' }, s), /Ya existe/);
  assert.throws(() => prep('createAccount', { name: 'banco', type: 'Bank', initialBalance: 0 }, s), /Ya existe/);
  assert.throws(() => prep('updateExistingTransaction', { description: 'Cine' }, s), /no cambia nada/);
  assert.throws(() => prep('goToPeriod', { month: '2026' }, s), /AAAA-MM/);
  assert.throws(() => prep('accionInventada', {}, s), /no admitida/);
  assert.throws(() => prep('deleteSavingsGoal', { name: 'Viaje' },
    { ...s, transactions: [{ ...s.transactions[0], savingId: 's1' }] }), /transacciones ligadas/);
});

test('una propuesta que alteraria un reembolso existente se rechaza', () => {
  const s = state();
  // Reembolso cuyo pendiente guardado no cuadra con la derivacion: aplicar cualquier
  // transaccion lo recalcularia, asi que no debe proponerse.
  s.refunds.push({ ...openRefund, pendingAmount: 99 });
  assert.throws(() => prep('recordNewTransaction',
    { description: 'Gasolina', amount: 40, category: 'Transporte', type: 'expense', accountName: 'Banco' }, s), /reembolsos/);
});

test('con reembolsos coherentes, registrar una transaccion si se permite', () => {
  const s = state();
  s.refunds.push({ ...openRefund });
  const p = prep('recordNewTransaction',
    { description: 'Gasolina', amount: 40, category: 'Transporte', type: 'expense', accountName: 'Banco' }, s);
  assert.equal(p.kind, 'createTransaction');
  assert.equal(p.value.accountId, 'a1');
  assert.equal(p.value.isRefund, false);
});

test('marcar un reembolso como cobrado no produce ninguna transaccion', () => {
  const s = state();
  s.refunds.push({ ...openRefund });
  const p = prep('markRefundAsSettled', { name: 'Cena' }, s);
  const writes = [];
  A.applyAdvisorProposal(p, s, {
    updateRefund: v => writes.push(v),
    addTransaction: () => assert.fail('no debe crear transacciones'),
    updateAccount: () => assert.fail('no debe tocar cuentas'),
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].pendingAmount, 0);
  assert.equal(writes[0].settledManually, true);
  assert.equal(JSON.stringify(s.transactions), JSON.stringify(state().transactions));
});

test('el contexto incluye cuentas, huchas, reembolsos y movimientos reales', () => {
  const s = state();
  s.refunds.push({ ...openRefund });
  const text = ctx.buildAdvisorContext({
    ...s, accountBalance: () => 480, savingBalance: () => 300, netWorth: () => 780,
  });
  for (const needle of ['Banco', 'Viaje', 'Ocio', 'Cine', 'Cena', 'Patrimonio neto', '2026-09']) {
    assert.ok(text.includes(needle), `falta "${needle}" en el contexto`);
  }
});
