import type { Account, AIChallenge, Budget, Refund, Saving, Transaction } from '../types';
import { syncRefundsWithTransactions, settleRefundManually } from '../services/refunds';

export type Context = {
  accounts: Account[]; savings: Saving[]; budgets: Budget[]; transactions: Transaction[];
  refunds: Refund[]; challenges: AIChallenge[]; currentDate: string; viewMode: 'month' | 'year';
};

type NewBudget = Omit<Budget, 'id' | 'spent'>;
type NewTransaction = Omit<Transaction, 'id'>;
type NewSaving = Omit<Saving, 'id'>;
type NewAccount = Omit<Account, 'id' | 'currentBalance'>;

// navigation: reversible al instante, se aplica sin preguntar.
// write:      modifica datos, exige confirmacion.
// destructive: borra datos, exige confirmacion reforzada.
export type ProposalTier = 'navigation' | 'write' | 'destructive';

export type ProposalValue =
  | { kind: 'setPeriod'; value: string }
  | { kind: 'setViewMode'; value: 'month' | 'year' }
  | { kind: 'toggleTheme'; value: null }
  | { kind: 'createBudget'; value: NewBudget }
  | { kind: 'updateBudget'; value: Budget }
  | { kind: 'deleteBudget'; value: Budget }
  | { kind: 'importBudget'; value: { from: string; to: string } }
  | { kind: 'createTransaction'; value: NewTransaction }
  | { kind: 'updateTransaction'; value: Transaction }
  | { kind: 'deleteTransaction'; value: Transaction }
  | { kind: 'createSaving'; value: NewSaving }
  | { kind: 'updateSaving'; value: Saving }
  | { kind: 'deleteSaving'; value: Saving }
  | { kind: 'createAccount'; value: NewAccount }
  | { kind: 'updateAccount'; value: Account }
  | { kind: 'createRefund'; value: Omit<Refund, 'id'> }
  | { kind: 'settleRefund'; value: Refund };

export type AdvisorProposal = { id: number; summary: string; baseline: string; tier: ProposalTier } & ProposalValue;

export interface AdvisorCallbacks {
  setPeriod: (date: string) => void;
  setViewMode: (mode: 'month' | 'year') => void;
  toggleTheme: () => void;
  addBudget: (value: NewBudget) => void;
  updateBudget: (value: Budget) => void;
  deleteBudget: (id: string) => void;
  importBudgetFromMonth: (from: string, to: string) => void;
  addTransaction: (value: NewTransaction) => void;
  updateTransaction: (value: Transaction) => void;
  deleteTransaction: (id: string) => void;
  addSaving: (value: NewSaving) => void;
  updateSaving: (value: Saving) => void;
  deleteSaving: (id: string) => void;
  addAccount: (value: NewAccount) => void;
  updateAccount: (value: Account) => void;
  addRefund: (value: Omit<Refund, 'id'>) => void;
  updateRefund: (value: Refund) => void;
}

const normalize = (value: string) => value.trim().toLocaleLowerCase('es');
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const actionBaseline = (c: Context) => JSON.stringify({
  accounts: c.accounts, savings: c.savings, budgets: c.budgets, transactions: c.transactions,
  refunds: c.refunds, challenges: c.challenges, currentDate: c.currentDate, viewMode: c.viewMode,
});

const readText = (value: unknown, field = 'dato'): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Falta ${field} en la propuesta.`);
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
const readMonth = (value: unknown): string => {
  const month = readText(value, 'el mes');
  if (!MONTH.test(month)) throw new Error('El mes debe tener el formato AAAA-MM.');
  return month;
};
const euros = (value: number) => `${value.toLocaleString('es-ES', { maximumFractionDigits: 20 })} €`;

// Busca exactamente una coincidencia por nombre. Si hay varias o ninguna, no se propone nada.
function onlyMatch<T>(items: T[], name: string, label: (item: T) => string, what: string): T {
  const matches = items.filter(item => normalize(label(item)) === normalize(name));
  if (matches.length !== 1) throw new Error(`No se puede identificar ${what} de forma inequívoca: "${name}".`);
  return matches[0];
}

// El historial de transacciones y los saldos no pueden cambiar como efecto colateral.
// Se comprueba simulando el resultado antes de proponer nada.
function assertRefundsUnchanged(context: Context, nextTransactions: Transaction[]): void {
  const after = syncRefundsWithTransactions(nextTransactions, context.refunds);
  if (JSON.stringify(after) !== JSON.stringify(context.refunds)) {
    throw new Error('Ese cambio alteraría reembolsos existentes, así que no se propone.');
  }
}

type Values = Record<string, unknown>;
type Builder = (v: Values, c: Context, today: string) => ProposalValue & { summary: string; tier: ProposalTier };

// Los objetivos de ahorro llevan el nombre de la hucha: fuera, para que Aura no los
// confunda con una categoria de gasto o ingreso del mismo nombre.
const periodBudgets = (c: Context) => c.budgets.filter(b => b.type !== 'saving' && (!b.period || b.period === c.currentDate));
const requireMonth = (c: Context) => {
  if (!MONTH.test(c.currentDate)) throw new Error('Selecciona un mes concreto antes de cambiar presupuestos.');
  return c.currentDate;
};

const builders: Record<string, Builder> = {
  // ---- Navegación: reversible, no toca datos ----
  goToPeriod: v => ({ kind: 'setPeriod', value: readMonth(v.month), tier: 'navigation',
    summary: `Ir al mes ${readMonth(v.month)}.` }),
  setViewMode: v => {
    const mode = v.mode === 'year' ? 'year' : v.mode === 'month' ? 'month' : null;
    if (!mode) throw new Error('La vista debe ser mensual o anual.');
    return { kind: 'setViewMode', value: mode, tier: 'navigation', summary: `Cambiar a vista ${mode === 'month' ? 'mensual' : 'anual'}.` };
  },
  toggleTheme: () => ({ kind: 'toggleTheme', value: null, tier: 'navigation', summary: 'Cambiar entre tema claro y oscuro.' }),

  // ---- Presupuestos ----
  createBudgetCategory: (v, c) => {
    const period = requireMonth(c);
    const category = readText(v.categoryName, 'la categoría');
    if (normalize(category).includes('ahorro')) throw new Error('El ahorro se gestiona desde las huchas.');
    if (periodBudgets(c).some(b => normalize(b.category) === normalize(category))) {
      throw new Error('Esa categoría ya existe este mes. No se propone una creación que la sobrescriba.');
    }
    const limit = readAmount(v.limit);
    const type = readType(v.type);
    return { kind: 'createBudget', tier: 'write',
      value: { category, limit, type, color: '#3b82f6', icon: 'ShoppingBag', period },
      summary: `Crear presupuesto de ${type === 'income' ? 'ingresos' : 'gastos'}: ${category}. Límite: ${euros(limit)}. Mes: ${period}.` };
  },
  updateExistingBudgetLimit: (v, c) => {
    const period = requireMonth(c);
    const budget = onlyMatch(periodBudgets(c), readText(v.categoryName, 'la categoría'), b => b.category, 'un presupuesto de este mes');
    if (budget.period !== period) throw new Error('Ese presupuesto no es propio de este mes.');
    const limit = readAmount(v.newLimit);
    return { kind: 'updateBudget', tier: 'write', value: { ...budget, limit },
      summary: `Cambiar límite de ${budget.category} (${budget.type === 'income' ? 'ingresos' : 'gastos'}), mes ${budget.period}: de ${euros(budget.limit)} a ${euros(limit)}.` };
  },
  deleteBudgetCategory: (v, c) => {
    const period = requireMonth(c);
    const budget = onlyMatch(periodBudgets(c), readText(v.categoryName, 'la categoría'), b => b.category, 'un presupuesto de este mes');
    if (budget.period !== period) throw new Error('Ese presupuesto no es propio de este mes.');
    return { kind: 'deleteBudget', tier: 'destructive', value: budget,
      summary: `BORRAR el presupuesto ${budget.category} (${budget.type === 'income' ? 'ingresos' : 'gastos'}) del mes ${budget.period}, con límite ${euros(budget.limit)}. Las transacciones de esa categoría no se tocan.` };
  },
  importBudgetsFromMonth: (v, c) => {
    const to = requireMonth(c);
    const from = readMonth(v.sourceMonth);
    if (from === to) throw new Error('El mes de origen y el de destino son el mismo.');
    if (!c.budgets.some(b => b.period === from)) throw new Error(`No hay presupuestos propios en ${from}.`);
    return { kind: 'importBudget', tier: 'write', value: { from, to },
      summary: `Copiar los presupuestos de ${from} al mes ${to}.` };
  },

  // ---- Transacciones ----
  recordNewTransaction: (v, c, today) => {
    const account = onlyMatch(c.accounts, readText(v.accountName, 'la cuenta'), a => a.name, 'una cuenta');
    const amount = readAmount(v.amount, false);
    const type = readType(v.type);
    const description = readText(v.description, 'la descripción');
    const category = readText(v.category, 'la categoría');
    const date = v.date === undefined ? today : readText(v.date, 'la fecha');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('La fecha debe tener el formato AAAA-MM-DD.');
    const value: NewTransaction = { date, amount, type, description, category, accountId: account.id, isRefund: false };
    assertRefundsUnchanged(c, [{ ...value, id: 'simulada' }, ...c.transactions]);
    return { kind: 'createTransaction', tier: 'write', value,
      summary: `Añadir ${type === 'income' ? 'ingreso' : 'gasto'}: ${description}. Importe: ${euros(amount)}. Cuenta: ${account.name}. Categoría: ${category}. Fecha: ${date}.` };
  },
  updateExistingTransaction: (v, c) => {
    const tx = onlyMatch(c.transactions, readText(v.description, 'la descripción'), t => t.description, 'una transacción');
    const amount = v.newAmount === undefined ? tx.amount : readAmount(v.newAmount, false);
    const category = v.newCategory === undefined ? tx.category : readText(v.newCategory, 'la categoría');
    if (amount === tx.amount && category === tx.category) throw new Error('La propuesta no cambia nada.');
    const value: Transaction = { ...tx, amount, category };
    assertRefundsUnchanged(c, c.transactions.map(t => (t.id === tx.id ? value : t)));
    const cambios = [
      amount !== tx.amount ? `importe de ${euros(tx.amount)} a ${euros(amount)}` : '',
      category !== tx.category ? `categoría de ${tx.category} a ${category}` : '',
    ].filter(Boolean).join(' y ');
    return { kind: 'updateTransaction', tier: 'write', value,
      summary: `Modificar la transacción "${tx.description}" del ${tx.date}: ${cambios}.` };
  },
  deleteExistingTransaction: (v, c) => {
    const tx = onlyMatch(c.transactions, readText(v.description, 'la descripción'), t => t.description, 'una transacción');
    if (tx.isRefund || tx.refundId) throw new Error('Esa transacción está ligada a un reembolso: bórrala desde la pantalla de reembolsos.');
    assertRefundsUnchanged(c, c.transactions.filter(t => t.id !== tx.id));
    return { kind: 'deleteTransaction', tier: 'destructive', value: tx,
      summary: `BORRAR la transacción "${tx.description}" del ${tx.date}, de ${euros(tx.amount)} (${tx.type === 'income' ? 'ingreso' : 'gasto'}, categoría ${tx.category}).` };
  },

  // ---- Huchas ----
  createSavingsGoal: (v, c) => {
    const name = readText(v.name, 'el nombre');
    if (c.savings.some(s => normalize(s.name) === normalize(name))) throw new Error('Ya existe una hucha con ese nombre.');
    const targetAmount = v.targetAmount === undefined ? undefined : readAmount(v.targetAmount, false);
    return { kind: 'createSaving', tier: 'write',
      value: { name, currentAmount: 0, targetAmount, isInvestment: v.isInvestment === true, color: '#3b82f6' },
      summary: `Crear la hucha "${name}"${targetAmount ? ` con objetivo ${euros(targetAmount)}` : ''}${v.isInvestment === true ? ' marcada como inversión' : ''}. Empieza en 0 €.` };
  },
  updateSavingsGoal: (v, c) => {
    const saving = onlyMatch(c.savings, readText(v.name, 'el nombre'), s => s.name, 'una hucha');
    const targetAmount = readAmount(v.newTargetAmount, false);
    if (targetAmount === saving.targetAmount) throw new Error('La propuesta no cambia nada.');
    return { kind: 'updateSaving', tier: 'write', value: { ...saving, targetAmount },
      summary: `Cambiar el objetivo de la hucha "${saving.name}": de ${saving.targetAmount ? euros(saving.targetAmount) : 'sin objetivo'} a ${euros(targetAmount)}. El saldo acumulado no se toca.` };
  },
  deleteSavingsGoal: (v, c) => {
    const saving = onlyMatch(c.savings, readText(v.name, 'el nombre'), s => s.name, 'una hucha');
    if (c.transactions.some(t => t.savingId === saving.id)) throw new Error('Esa hucha tiene transacciones ligadas: no se puede borrar desde Aura.');
    return { kind: 'deleteSaving', tier: 'destructive', value: saving,
      summary: `BORRAR la hucha "${saving.name}", que acumula ${euros(saving.currentAmount)}.` };
  },

  // ---- Cuentas ----
  createAccount: (v, c) => {
    const name = readText(v.name, 'el nombre');
    if (c.accounts.some(a => normalize(a.name) === normalize(name))) throw new Error('Ya existe una cuenta con ese nombre.');
    const kind = v.type === 'Cash' ? 'Cash' : v.type === 'Card' ? 'Card' : 'Bank';
    const initialBalance = readAmount(v.initialBalance);
    return { kind: 'createAccount', tier: 'write', value: { name, type: kind, initialBalance, color: '#3b82f6' },
      summary: `Crear la cuenta "${name}" (${kind}) con saldo inicial ${euros(initialBalance)}.` };
  },
  renameAccount: (v, c) => {
    const account = onlyMatch(c.accounts, readText(v.currentName, 'el nombre actual'), a => a.name, 'una cuenta');
    const name = readText(v.newName, 'el nombre nuevo');
    if (c.accounts.some(a => a.id !== account.id && normalize(a.name) === normalize(name))) throw new Error('Ya existe otra cuenta con ese nombre.');
    return { kind: 'updateAccount', tier: 'write', value: { ...account, name },
      summary: `Renombrar la cuenta "${account.name}" a "${name}". El saldo y sus transacciones no se tocan.` };
  },

  // ---- Reembolsos ----
  markRefundAsSettled: (v, c) => {
    const refund = onlyMatch(c.refunds.filter(r => r.status === 'open'), readText(v.name, 'el nombre'), r => r.name, 'un reembolso abierto');
    return { kind: 'settleRefund', tier: 'write', value: settleRefundManually(refund),
      summary: `Marcar como cobrado el reembolso "${refund.name}" (pendiente ${euros(refund.pendingAmount)}). Solo cierra el reembolso: no crea ninguna transacción ni modifica saldos.` };
  },
};

export function prepareAdvisorProposal(name: string, args: unknown, context: Context, id: number, today: string): AdvisorProposal {
  const builder = builders[name];
  if (!builder) throw new Error('Aura ha propuesto una acción no admitida.');
  if (args !== undefined && args !== null && (typeof args !== 'object' || Array.isArray(args))) throw new Error('Propuesta incompleta.');
  const { summary, tier, ...rest } = builder((args || {}) as Values, context, today);
  return { id, baseline: actionBaseline(context), summary, tier, ...rest } as AdvisorProposal;
}

// La navegacion no altera datos, asi que no necesita confirmacion ni instantanea.
export const needsConfirmation = (proposal: AdvisorProposal) => proposal.tier !== 'navigation';

export function applyAdvisorProposal(proposal: AdvisorProposal, context: Context, cb: AdvisorCallbacks): void {
  if (needsConfirmation(proposal) && proposal.baseline !== actionBaseline(context)) {
    throw new Error('Los datos o el mes han cambiado. Solicita una nueva propuesta antes de confirmar.');
  }
  switch (proposal.kind) {
    case 'setPeriod': return cb.setPeriod(proposal.value);
    case 'setViewMode': return cb.setViewMode(proposal.value);
    case 'toggleTheme': return cb.toggleTheme();
    case 'createBudget': return cb.addBudget(proposal.value);
    case 'updateBudget': return cb.updateBudget(proposal.value);
    case 'deleteBudget': return cb.deleteBudget(proposal.value.id);
    case 'importBudget': return cb.importBudgetFromMonth(proposal.value.from, proposal.value.to);
    case 'createTransaction': {
      assertRefundsUnchanged(context, [{ ...proposal.value, id: 'simulada' }, ...context.transactions]);
      return cb.addTransaction(proposal.value);
    }
    case 'updateTransaction': {
      assertRefundsUnchanged(context, context.transactions.map(t => (t.id === proposal.value.id ? proposal.value : t)));
      return cb.updateTransaction(proposal.value);
    }
    case 'deleteTransaction': {
      assertRefundsUnchanged(context, context.transactions.filter(t => t.id !== proposal.value.id));
      return cb.deleteTransaction(proposal.value.id);
    }
    case 'createSaving': return cb.addSaving(proposal.value);
    case 'updateSaving': return cb.updateSaving(proposal.value);
    case 'deleteSaving': return cb.deleteSaving(proposal.value.id);
    case 'createAccount': return cb.addAccount(proposal.value);
    case 'updateAccount': return cb.updateAccount(proposal.value);
    case 'createRefund': return cb.addRefund(proposal.value);
    case 'settleRefund': return cb.updateRefund(proposal.value);
  }
}
