import type { Refund, Transaction } from '../types';

// Los reembolsos derivan su importe pendiente de los ingresos enlazados:
// pendiente = (total - lo que puse yo) - lo ya recuperado.
//
// La excepcion es el saldo manual. Cuando el usuario marca un reembolso como
// cobrado (le pagaron en efectivo, por Bizum sin registrar, etc.) no existe
// ninguna transaccion que lo respalde, asi que recalcular lo devolveria a la
// deuda integra. Por eso un reembolso saldado a mano se respeta tal cual.
export const isManuallySettled = (refund: Refund): boolean =>
  refund.settledManually === true && refund.status === 'closed';

export function syncRefundsWithTransactions(
  transactions: Transaction[],
  existingRefunds: Refund[],
): Refund[] {
  return existingRefunds.map(refund => {
    if (isManuallySettled(refund)) return refund;

    const totalRecovered = transactions.reduce(
      (sum, t) => (t.type === 'income' && t.refundId === refund.id ? sum + Number(t.amount || 0) : sum),
      0,
    );
    const initialDebt = Number(refund.totalAmount || 0) - Number(refund.paidByMe || 0);
    const pendingAmount = Math.max(0, initialDebt - totalRecovered);
    return {
      ...refund,
      pendingAmount,
      status: pendingAmount <= 0.01 ? 'closed' : refund.status,
    } as Refund;
  });
}

// Marcar como cobrado: el pendiente se fija a cero y queda protegido del
// recalculo hasta que el usuario lo reabra.
export const settleRefundManually = (refund: Refund): Refund =>
  ({ ...refund, status: 'closed', pendingAmount: 0, settledManually: true });

// Reabrir devuelve el reembolso al calculo automatico.
export const reopenRefund = (refund: Refund): Refund =>
  ({ ...refund, status: 'open', settledManually: false });
