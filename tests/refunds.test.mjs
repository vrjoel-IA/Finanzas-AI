import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(relativePath) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require(name) { throw new Error(`Forbidden dependency: ${name}`); }, console, Math, Number },
    { filename: relativePath });
  return exports;
}
const { syncRefundsWithTransactions, settleRefundManually, reopenRefund } = load('../services/refunds.ts');

const openRefund = () => ({
  id: 'r1', name: 'Cena', totalAmount: 100, paidByMe: 40, pendingAmount: 60,
  status: 'open', notes: '', date: '2026-09-01', category: 'Ocio',
});
// Historial que NUNCA debe cambiar al tocar reembolsos.
const history = () => [
  { id: 't1', amount: 100, type: 'expense', accountId: 'a1', date: '2026-09-01', category: 'Ocio', description: 'Cena', isRefund: true, refundId: 'r1' },
  { id: 't2', amount: 30, type: 'expense', accountId: 'a1', date: '2026-09-03', category: 'Super', description: 'Compra', isRefund: false },
];

test('marcar como cobrado solo cierra el reembolso: no crea ni modifica transacciones', () => {
  const transactions = history();
  const before = JSON.stringify(transactions);
  const settled = settleRefundManually(openRefund());
  assert.equal(settled.status, 'closed');
  assert.equal(settled.pendingAmount, 0);
  assert.equal(settled.settledManually, true);
  // La funcion devuelve SOLO el reembolso: ninguna transaccion ni cuenta en el resultado.
  assert.deepEqual(Object.keys(settled).sort(), [...Object.keys(openRefund()), 'settledManually'].sort());
  assert.equal(JSON.stringify(transactions), before);
});

test('el recalculo respeta un reembolso cobrado a mano y no toca el historial', () => {
  const transactions = history();
  const before = JSON.stringify(transactions);
  const settled = settleRefundManually(openRefund());
  const [result] = syncRefundsWithTransactions(transactions, [settled]);
  // Sin la proteccion, el pendiente volveria a 60 (la deuda integra).
  assert.equal(result.pendingAmount, 0);
  assert.equal(result.status, 'closed');
  assert.equal(JSON.stringify(transactions), before);
});

test('anadir una transaccion no reabre ni altera un reembolso saldado a mano', () => {
  const settled = settleRefundManually(openRefund());
  const conNueva = [...history(), { id: 't3', amount: 20, type: 'income', accountId: 'a1', date: '2026-09-10', category: 'Otros', description: 'Ingreso suelto', isRefund: false }];
  const [result] = syncRefundsWithTransactions(conNueva, [settled]);
  assert.equal(JSON.stringify(result), JSON.stringify(settled));
});

test('los reembolsos normales siguen derivando su pendiente de los ingresos enlazados', () => {
  const conIngreso = [...history(), { id: 't4', amount: 25, type: 'income', accountId: 'a1', date: '2026-09-05', category: 'Ocio', description: 'Me devuelve', isRefund: false, refundId: 'r1' }];
  const [result] = syncRefundsWithTransactions(conIngreso, [openRefund()]);
  assert.equal(result.pendingAmount, 35); // 100 - 40 - 25
  assert.equal(result.status, 'open');
});

test('un reembolso preexistente (sin el campo nuevo) se comporta igual que antes', () => {
  const legacy = openRefund();
  assert.equal('settledManually' in legacy, false);
  const [result] = syncRefundsWithTransactions(history(), [legacy]);
  assert.equal(result.pendingAmount, 60);
  assert.equal(result.status, 'open');
});

test('reabrir devuelve el reembolso al calculo automatico', () => {
  const reopened = reopenRefund(settleRefundManually(openRefund()));
  const [result] = syncRefundsWithTransactions(history(), [reopened]);
  assert.equal(result.pendingAmount, 60);
  assert.equal(result.status, 'open');
});
