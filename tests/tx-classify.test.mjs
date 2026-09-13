import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServices } from './_load.mjs';

const { txClassify } = loadServices();
const { classifyTransaction, isSavingTx, isTransferTx, isRefundRecovery } = txClassify;

const tx = (over = {}) => ({
  id: 't', date: '2026-09-10', amount: 50, description: 'x',
  category: 'Ocio', type: 'expense', accountId: 'a1', isRefund: false, ...over,
});

// Como era antes: la misma logica copiada en Dashboard.tsx:65-66, usada como
// oraculo para comprobar que unificarla no cambia ninguna cifra.
const oldIsSaving = t => t.category === 'Ahorro' || t.category === 'Ahorros' || !!t.savingId;
const oldIsTransfer = t => t.category === 'Traspaso' || t.category === 'Transferencia';

test('reconoce huchas por savingId y por las categorias heredadas', () => {
  assert.equal(isSavingTx(tx({ savingId: 's1' })), true);
  assert.equal(isSavingTx(tx({ category: 'Ahorro' })), true);
  assert.equal(isSavingTx(tx({ category: 'Ahorros' })), true);
  assert.equal(isSavingTx(tx({ category: 'Ocio' })), false);
});

test('reconoce traspasos por sus dos categorias', () => {
  assert.equal(isTransferTx(tx({ category: 'Traspaso' })), true);
  assert.equal(isTransferTx(tx({ category: 'Transferencia' })), true);
  assert.equal(isTransferTx(tx({ category: 'Ocio' })), false);
});

test('un reembolso solo cuenta como tal cuando es un ingreso enlazado', () => {
  assert.equal(isRefundRecovery(tx({ type: 'income', refundId: 'r1' })), true);
  assert.equal(isRefundRecovery(tx({ type: 'expense', refundId: 'r1' })), false);
  assert.equal(isRefundRecovery(tx({ type: 'income' })), false);
});

test('precedencia: traspaso gana a hucha, y hucha gana a reembolso', () => {
  assert.equal(classifyTransaction(tx({ category: 'Traspaso', savingId: 's1', type: 'expense' })), 'transferOut');
  assert.equal(classifyTransaction(tx({ category: 'Traspaso', type: 'income' })), 'transferIn');
  assert.equal(classifyTransaction(tx({ savingId: 's1', refundId: 'r1', type: 'income' })), 'savingWithdrawal');
  assert.equal(classifyTransaction(tx({ savingId: 's1', type: 'expense' })), 'savingDeposit');
});

test('clasificacion basica de ingreso, gasto y reembolso', () => {
  assert.equal(classifyTransaction(tx({ type: 'expense' })), 'expense');
  assert.equal(classifyTransaction(tx({ type: 'income' })), 'income');
  assert.equal(classifyTransaction(tx({ type: 'income', refundId: 'r1' })), 'refundRecovery');
});

test('regresion: la clasificacion coincide con la logica antigua del Dashboard', () => {
  const categories = ['Ocio', 'Alimentacion', 'Ahorro', 'Ahorros', 'Traspaso', 'Transferencia', ''];
  const types = ['income', 'expense'];
  const savingIds = [undefined, 's1'];
  const refundIds = [undefined, 'r1'];

  for (const category of categories) {
    for (const type of types) {
      for (const savingId of savingIds) {
        for (const refundId of refundIds) {
          const t = tx({ category, type, savingId, refundId });
          const kind = classifyTransaction(t);
          const label = JSON.stringify({ category, type, savingId, refundId });

          // Ingreso base del Dashboard: income && !refundId && !hucha && !traspaso
          const wasBaseIncome = type === 'income' && !refundId && !oldIsSaving(t) && !oldIsTransfer(t);
          assert.equal(kind === 'income', wasBaseIncome, 'ingreso base ' + label);

          // Gasto base del Dashboard: expense && !hucha && !traspaso
          const wasBaseExpense = type === 'expense' && !oldIsSaving(t) && !oldIsTransfer(t);
          assert.equal(kind === 'expense', wasBaseExpense, 'gasto base ' + label);

          // Movimientos de hucha del Dashboard, que ya excluian traspasos.
          const wasDeposit = type === 'expense' && oldIsSaving(t) && !oldIsTransfer(t);
          assert.equal(kind === 'savingDeposit', wasDeposit, 'aportacion a hucha ' + label);
          const wasWithdrawal = type === 'income' && oldIsSaving(t) && !oldIsTransfer(t);
          assert.equal(kind === 'savingWithdrawal', wasWithdrawal, 'retirada de hucha ' + label);
        }
      }
    }
  }
});
