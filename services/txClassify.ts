import type { Transaction } from '../types';

// Clasificacion unica de transacciones. Hasta ahora esta logica estaba copiada
// en cuatro sitios (Dashboard y tres veces en Transactions) con criterios que no
// coincidian entre si; cualquier cambio se olvidaba en alguna de las copias.

// Una transaccion de hucha se reconoce por el vinculo savingId. Las categorias
// se aceptan por compatibilidad con datos antiguos anteriores a savingId.
export const SAVING_CATEGORIES = ['Ahorro', 'Ahorros'];

// Traspasos entre cuentas propias y aportaciones a una cuenta conjunta: mueven
// saldo pero no son ni ingreso ni gasto, asi que no cuentan en ningun total.
export const NEUTRAL_CATEGORIES = ['Traspaso', 'Transferencia'];

export type TxKind =
  | 'income'
  | 'expense'
  | 'refundRecovery'
  | 'savingDeposit'
  | 'savingWithdrawal'
  | 'transferIn'
  | 'transferOut';

export const isSavingTx = (t: Transaction): boolean =>
  SAVING_CATEGORIES.indexOf(t.category) !== -1 || !!t.savingId;

export const isTransferTx = (t: Transaction): boolean =>
  NEUTRAL_CATEGORIES.indexOf(t.category) !== -1;

export const isRefundRecovery = (t: Transaction): boolean =>
  t.type === 'income' && !!t.refundId;

// Precedencia: traspaso > hucha > reembolso > ingreso/gasto.
// Es la que ya aplicaba el Dashboard: sus filtros de ingreso y gasto base
// excluyen primero traspasos y huchas, y solo despues miran refundId.
export function classifyTransaction(t: Transaction): TxKind {
  if (isTransferTx(t)) return t.type === 'income' ? 'transferIn' : 'transferOut';
  if (isSavingTx(t)) return t.type === 'income' ? 'savingWithdrawal' : 'savingDeposit';
  if (isRefundRecovery(t)) return 'refundRecovery';
  return t.type === 'income' ? 'income' : 'expense';
}
