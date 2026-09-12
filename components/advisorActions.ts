import type { Budget, FinanceState, Transaction } from '../types';

type Context = Pick<FinanceState, 'accounts' | 'budgets' | 'transactions' | 'refunds' | 'currentDate'>;
type NewBudget = Omit<Budget, 'id' | 'spent'>;
export type AdvisorProposal = {
  id: number;
  summary: string;
  baseline: string;
} & (
  | { kind: 'createBudget'; value: NewBudget }
  | { kind: 'updateBudget'; value: Budget }
  | { kind: 'createTransaction'; value: Omit<Transaction, 'id'> }
);

const normalize = (value: string) => value.trim().toLocaleLowerCase('es');
export const actionBaseline = (context: Context) => JSON.stringify({
  accounts: context.accounts, budgets: context.budgets, transactions: context.transactions,
  refunds: context.refunds, currentDate: context.currentDate,
});
const readText = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Faltan datos en la propuesta.');
  return value.trim();
};
const readAmount = (value: unknown, allowZero = true): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error('La propuesta contiene un importe no válido.');
  }
  return value;
};
const readType = (value: unknown): 'income' | 'expense' => {
  if (value !== 'income' && value !== 'expense') throw new Error('El tipo de movimiento no es válido.');
  return value;
};
const euros = (value: number) => `${value.toLocaleString('es-ES', { maximumFractionDigits: 20 })} €`;

// Pure preparation: no storage, network or finance callbacks are available here.
export function prepareAdvisorProposal(
  name: string, args: unknown, context: Context, id: number, date: string,
): AdvisorProposal {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Propuesta incompleta.');
  const values = args as Record<string, unknown>;
  const base = { id, baseline: actionBaseline(context) };
  if (name === 'recordNewTransaction') {
    // App.addTransaction recalculates every refund. Do not expose existing refunds to that side effect.
    if (context.refunds.length) throw new Error('Esta transacción no se puede aplicar desde Aura: el alta actual recalcula los reembolsos existentes.');
    const accountName = readText(values.accountName);
    const matches = context.accounts.filter(a => normalize(a.name) === normalize(accountName));
    if (matches.length !== 1) throw new Error('No se puede identificar una única cuenta para la propuesta.');
    const amount = readAmount(values.amount, false);
    const type = readType(values.type);
    const description = readText(values.description);
    const category = readText(values.category);
    return { ...base, kind: 'createTransaction',
      value: { date, amount, type, description, category, accountId: matches[0].id, isRefund: false },
      summary: `Añadir ${type === 'income' ? 'ingreso' : 'gasto'}: ${description}. Importe: ${euros(amount)}. Cuenta: ${matches[0].name}. Categoría: ${category}. Fecha: ${date}.`,
    };
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(context.currentDate)) throw new Error('Selecciona un mes para revisar un cambio de presupuesto.');
  const category = readText(values.categoryName);
  const matches = context.budgets.filter(b => normalize(b.category) === normalize(category) && (!b.period || b.period === context.currentDate));
  if (name === 'createBudgetCategory') {
    if (normalize(category).includes('ahorro')) throw new Error('El ahorro se gestiona desde las huchas.');
    // addBudget would overwrite an existing category: never treat that as a creation.
    if (matches.length) throw new Error('La categoría ya existe. No se aplicará una creación que pueda sobrescribirla.');
    const limit = readAmount(values.limit);
    const type = readType(values.type);
    return { ...base, kind: 'createBudget',
      value: { category, limit, type, color: '#3b82f6', icon: 'ShoppingBag', period: context.currentDate },
      summary: `Crear presupuesto de ${type === 'income' ? 'ingresos' : 'gastos'}: ${category}. Límite: ${euros(limit)}. Mes: ${context.currentDate}.`,
    };
  }
  if (name === 'updateExistingBudgetLimit') {
    if (matches.length !== 1 || matches[0].period !== context.currentDate) throw new Error('No se puede identificar un único presupuesto propio de este mes.');
    const budget = matches[0];
    const limit = readAmount(values.newLimit);
    return { ...base, kind: 'updateBudget', value: { ...budget, limit },
      summary: `Cambiar límite de ${budget.category} (${budget.type === 'income' ? 'ingresos' : 'gastos'}), mes ${budget.period}: de ${euros(budget.limit)} a ${euros(limit)}.`,
    };
  }
  throw new Error('Aura ha propuesto una acción no admitida.');
}

export function applyAdvisorProposal(proposal: AdvisorProposal, context: Context, callbacks: {
  addBudget: (value: NewBudget) => void;
  updateBudget: (value: Budget) => void;
  addTransaction: (value: Omit<Transaction, 'id'>) => void;
}): void {
  if (proposal.baseline !== actionBaseline(context)) {
    throw new Error('Los datos o el mes han cambiado. Solicita una nueva propuesta antes de confirmar.');
  }
  if (proposal.kind === 'createBudget') callbacks.addBudget(proposal.value);
  else if (proposal.kind === 'updateBudget') callbacks.updateBudget(proposal.value);
  else {
    if (context.refunds.length) throw new Error('No se pueden crear transacciones desde Aura mientras existan reembolsos.');
    callbacks.addTransaction(proposal.value);
  }
}
