import type { Budget } from '../types';
import type { PeriodIndex } from './periodIndex';
import { aggregatePeriod } from './periodIndex';
import { isMonthKey, isYearKey, monthsOfYear, sameMonthPreviousYear } from './periods';
import type { MonthKey, PeriodKey } from './periods';

// Resolucion de presupuestos por derivacion.
//
// Hasta ahora un mes sin presupuesto propio salia vacio en el dashboard, y solo
// al entrar en la pantalla de Presupuesto un useEffect copiaba los del mes
// anterior: es decir, navegar escribia datos. Aqui la herencia se CALCULA, no se
// escribe. Lo unico que escribe es materializeBudgets, y solo cuando el usuario
// pulsa "Personalizar este mes".
//
// Prioridad de la fuente de herencia:
//   1. el mismo mes del anio anterior, si fue un mes normal
//   2. el mes anterior mas reciente que tenga presupuesto propio
// Octubre se parece mas a octubre que a septiembre; por eso el anio anterior va
// primero. Pero solo si aquel mes fue representativo: heredar de la mudanza o de
// unas vacaciones no sirve de nada.

export type BudgetOrigin = 'own' | 'inherited' | 'legacy' | 'annualized';

export type BudgetType = 'income' | 'expense' | 'saving';

/**
 * Categorias retiradas a mano de un mes: periodo -> claves budgetKey. Sin esto,
 * borrar un presupuesto de un mes lo haria reaparecer al instante heredado del
 * mes de origen, porque la herencia rellena toda categoria que falte.
 */
export type BudgetExclusions = Record<string, string[]>;

/** Presupuestos y exclusiones: lo que cambia junto al editar un mes. */
export interface BudgetBook {
  budgets: Budget[];
  exclusions: BudgetExclusions;
}

export interface EffectiveBudget extends Budget {
  origin: BudgetOrigin;
  /** Periodo del que se hereda. Solo cuando origin === 'inherited'. */
  inheritedFrom?: MonthKey;
  /** Id del Budget original. Materializar crea una copia; el original no se toca. */
  sourceId: string;
  /** Solo los propios del periodo se pueden editar o borrar directamente. */
  editable: boolean;
}

export interface InheritanceSource {
  period: MonthKey;
  reason: 'previous-year' | 'previous-month';
}

/** Desviacion maxima admitida frente al gasto tipico para considerar un mes representativo. */
export const NORMAL_MONTH_TOLERANCE = 0.5;
const NORMAL_MONTH_WINDOW = 24;

/** Un presupuesto sin tipo cuenta como gasto, igual que siempre. */
export const budgetType = (b: Pick<Budget, 'type'>): BudgetType =>
  b.type === 'income' ? 'income' : b.type === 'saving' ? 'saving' : 'expense';

/**
 * Clave de identidad. Sin el tipo, un ingreso y un gasto de la misma categoria se
 * pisan. Un objetivo de ahorro se identifica por su hucha, no por el nombre: asi
 * renombrar la hucha no rompe la herencia.
 */
export const budgetKey = (b: Pick<Budget, 'type' | 'category' | 'savingId'>): string =>
  budgetType(b) === 'saving'
    ? 'saving|' + (b.savingId || b.category)
    : b.category + '|' + budgetType(b);

export type BudgetStatus = 'over' | 'achieved' | 'normal';

/**
 * Estado de una tarjeta. Un gasto se "pasa"; un ingreso o un objetivo de ahorro
 * se "logra". Con limite cero un ingreso no se da por logrado: no habia objetivo.
 */
export function budgetStatus(b: { type?: string; spent: number; limit: number }): BudgetStatus {
  const type = budgetType(b as Pick<Budget, 'type'>);
  const spent = Number(b.spent) || 0;
  const limit = Number(b.limit) || 0;
  if (type === 'expense') return spent - limit > 0.005 ? 'over' : 'normal';
  return limit > 0 && spent - limit >= -0.005 ? 'achieved' : 'normal';
}

const excludedIn = (exclusions: BudgetExclusions | undefined, period: PeriodKey): string[] => {
  const list = exclusions && exclusions[period];
  return Array.isArray(list) ? list : [];
};

const ownBudgets = (budgets: Budget[], period: PeriodKey): Budget[] =>
  budgets.filter(b => b.period === period);

export const hasOwnBudgets = (budgets: Budget[], period: PeriodKey): boolean =>
  budgets.some(b => b.period === period);

/** Presupuestos guardados con un periodo que no es un mes valido (por ejemplo '2026'). */
export function listOrphanBudgets(budgets: Budget[]): Budget[] {
  return budgets.filter(b => !!b.period && !isMonthKey(b.period));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Gasto tipico: mediana de los ultimos meses con actividad de gasto. */
export function typicalMonthlyExpense(index: PeriodIndex, window: number = NORMAL_MONTH_WINDOW): number {
  const keys = index.monthKeys.slice(-window);
  const expenses: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    const month = index.months[keys[i]];
    if (month && month.baseExpense > 0) expenses.push(month.baseExpense);
  }
  return median(expenses);
}

/**
 * Un mes es representativo si tiene presupuesto propio, movimiento real de
 * ingresos y de gastos, y un gasto total que no se dispara respecto a lo habitual.
 */
export function isNormalMonth(budgets: Budget[], index: PeriodIndex, period: PeriodKey): boolean {
  if (!isMonthKey(period)) return false;
  if (!hasOwnBudgets(budgets, period)) return false;

  const month = index.months[period];
  if (!month) return false;
  if (!(month.baseIncome > 0) || !(month.baseExpense > 0)) return false;

  const typical = typicalMonthlyExpense(index);
  if (!(typical > 0)) return true; // sin referencia con la que comparar, se acepta
  return Math.abs(month.baseExpense - typical) / typical <= NORMAL_MONTH_TOLERANCE;
}

/** Meses con presupuesto propio anteriores al objetivo, del mas reciente al mas antiguo. */
function previousOwnMonths(budgets: Budget[], target: MonthKey): MonthKey[] {
  const seen: Record<string, boolean> = {};
  const months: MonthKey[] = [];
  for (let i = 0; i < budgets.length; i++) {
    const period = budgets[i].period;
    if (!period || !isMonthKey(period) || period >= target || seen[period]) continue;
    seen[period] = true;
    months.push(period);
  }
  return months.sort().reverse();
}

/** Elige de donde hereda un mes. Una sola fuente: asi borrar una categoria la borra de verdad. */
export function findInheritanceSource(
  budgets: Budget[],
  index: PeriodIndex,
  target: PeriodKey,
): InheritanceSource | null {
  if (!isMonthKey(target)) return null;

  const lastYear = sameMonthPreviousYear(target);
  if (lastYear && isNormalMonth(budgets, index, lastYear)) {
    return { period: lastYear, reason: 'previous-year' };
  }

  const candidates = previousOwnMonths(budgets, target);
  if (candidates.length) return { period: candidates[0], reason: 'previous-month' };

  return null;
}

const toEffective = (
  budget: Budget,
  origin: BudgetOrigin,
  inheritedFrom?: MonthKey,
): EffectiveBudget => ({
  ...budget,
  type: budgetType(budget),
  origin,
  inheritedFrom,
  sourceId: budget.id,
  editable: origin === 'own',
});

/**
 * Presupuestos aplicables a un periodo. Funcion pura: no muta la entrada ni crea
 * nada persistente. Precedencia por categoria: propio > heredado > sin periodo.
 */
export function resolveEffectiveBudgets(
  budgets: Budget[],
  target: PeriodKey,
  index: PeriodIndex,
  exclusions?: BudgetExclusions,
): EffectiveBudget[] {
  const list = Array.isArray(budgets) ? budgets : [];

  if (isYearKey(target)) return annualizeYear(list, target, index, exclusions);

  const result: EffectiveBudget[] = [];
  const taken: Record<string, boolean> = {};

  const own = ownBudgets(list, target);
  for (let i = 0; i < own.length; i++) {
    const key = budgetKey(own[i]);
    if (taken[key]) continue;
    taken[key] = true;
    result.push(toEffective(own[i], 'own'));
  }

  // Lo retirado a mano tapa la herencia y lo antiguo, pero nunca a un propio:
  // si el usuario vuelve a crear la categoria, manda lo que acaba de crear.
  const excluded = excludedIn(exclusions, target);
  for (let i = 0; i < excluded.length; i++) taken[excluded[i]] = true;

  const source = findInheritanceSource(list, index, target);
  if (source) {
    const inherited = ownBudgets(list, source.period);
    for (let i = 0; i < inherited.length; i++) {
      const key = budgetKey(inherited[i]);
      if (taken[key]) continue;
      taken[key] = true;
      result.push(toEffective(inherited[i], 'inherited', source.period));
    }
  }

  // Presupuestos antiguos sin periodo: siguen aplicando a cualquier mes que no
  // tenga ya esa categoria, igual que antes.
  for (let i = 0; i < list.length; i++) {
    if (list[i].period) continue;
    const key = budgetKey(list[i]);
    if (taken[key]) continue;
    taken[key] = true;
    result.push(toEffective(list[i], 'legacy'));
  }

  return result;
}

/** Vista anual: suma de los limites realmente aplicables en cada uno de los doce meses. */
function annualizeYear(
  budgets: Budget[],
  year: string,
  index: PeriodIndex,
  exclusions?: BudgetExclusions,
): EffectiveBudget[] {
  const months = monthsOfYear(year);
  const totals: Record<string, EffectiveBudget> = {};
  const order: string[] = [];

  for (let m = 0; m < months.length; m++) {
    const monthly = resolveEffectiveBudgets(budgets, months[m], index, exclusions);
    for (let i = 0; i < monthly.length; i++) {
      const budget = monthly[i];
      const key = budgetKey(budget);
      if (!totals[key]) {
        totals[key] = { ...budget, limit: 0, spent: 0, origin: 'annualized', inheritedFrom: undefined, editable: false };
        order.push(key);
      }
      totals[key].limit += budget.limit;
    }
  }

  return order.map(key => totals[key]);
}

/**
 * Convierte presupuestos heredados en propios del periodo. Devuelve el array
 * completo nuevo; no muta la entrada y no toca los presupuestos de origen.
 */
export function materializeBudgets(
  budgets: Budget[],
  target: MonthKey,
  categories: string[] | 'all',
  newId: () => string,
  index: PeriodIndex,
  exclusions?: BudgetExclusions,
): Budget[] {
  if (!isMonthKey(target)) return budgets;

  const list = Array.isArray(budgets) ? budgets : [];
  const effective = resolveEffectiveBudgets(list, target, index, exclusions);
  const wanted = categories === 'all' ? null : categories;

  const created: Budget[] = [];
  for (let i = 0; i < effective.length; i++) {
    const budget = effective[i];
    if (budget.origin === 'own') continue;
    if (wanted && wanted.indexOf(budget.category) === -1) continue;
    const copy: Budget = {
      id: newId(),
      category: budget.category,
      limit: budget.limit,
      icon: budget.icon,
      spent: 0,
      type: budgetType(budget),
      color: budget.color,
      period: target,
    };
    if (budget.savingId) copy.savingId = budget.savingId;
    created.push(copy);
  }

  return created.length ? list.concat(created) : list;
}

function withExclusion(exclusions: BudgetExclusions, period: MonthKey, key: string, excluded: boolean): BudgetExclusions {
  const current = excludedIn(exclusions, period);
  const has = current.indexOf(key) !== -1;
  if (has === excluded) return exclusions;
  const nextList = excluded ? current.concat([key]) : current.filter(k => k !== key);
  const next: BudgetExclusions = { ...exclusions };
  if (nextList.length) next[period] = nextList;
  else delete next[period];
  return next;
}

const normalizeBook = (book: BudgetBook): BudgetBook => ({
  budgets: Array.isArray(book.budgets) ? book.budgets : [],
  exclusions: book.exclusions && typeof book.exclusions === 'object' ? book.exclusions : {},
});

/**
 * Crea o edita un presupuesto de un mes, sea propio o heredado.
 *
 * Una tarjeta heredada es el presupuesto de OTRO mes: editarla tal cual cambiaria
 * aquel mes. Por eso, antes de nada, el mes se materializa entero. Entero y no
 * solo la categoria tocada: un mes con un unico presupuesto propio pasaria a ser
 * la fuente de herencia de los siguientes y estos heredarian solo esa categoria.
 *
 * `original` es la tarjeta que se edita (null para crear). Si el cambio choca con
 * otra categoria propia del mes, no se toca nada: la interfaz debe avisar antes.
 */
export function saveBudgetInMonth(
  book: BudgetBook,
  target: PeriodKey,
  original: Pick<Budget, 'type' | 'category' | 'savingId'> | null,
  changes: Omit<Budget, 'id' | 'spent' | 'period'>,
  newId: () => string,
  index: PeriodIndex,
): BudgetBook {
  const safe = normalizeBook(book);
  if (!isMonthKey(target)) return book;

  const budgets = materializeBudgets(safe.budgets, target, 'all', newId, index, safe.exclusions);
  const newKey = budgetKey(changes);
  const oldKey = original ? budgetKey(original) : null;

  const findOwn = (key: string) => {
    for (let i = 0; i < budgets.length; i++) {
      if (budgets[i].period === target && budgetKey(budgets[i]) === key) return i;
    }
    return -1;
  };

  const editing = oldKey ? findOwn(oldKey) : -1;
  const clash = findOwn(newKey);
  if (clash !== -1 && clash !== editing) {
    // Crear algo que ya existe es editarlo; renombrar encima de otra, no.
    if (oldKey) return book;
  }

  const slot = editing !== -1 ? editing : clash;
  const next = budgets.slice();
  if (slot !== -1) {
    const merged: Budget = { ...next[slot], ...changes, id: next[slot].id, spent: next[slot].spent || 0, period: target };
    if (budgetType(merged) !== 'saving') delete merged.savingId;
    next[slot] = merged;
  } else {
    const created: Budget = { ...changes, id: newId(), spent: 0, period: target };
    if (budgetType(created) !== 'saving') delete created.savingId;
    next.push(created);
  }

  let exclusions = withExclusion(safe.exclusions, target, newKey, false);
  // Al renombrar, el nombre viejo sigue vivo en el mes de origen: sin excluirlo
  // volveria a aparecer heredado junto al nuevo.
  if (oldKey && oldKey !== newKey) exclusions = withExclusion(exclusions, target, oldKey, true);

  return { budgets: next, exclusions };
}

/** Retira un presupuesto de un mes, sea propio o heredado, sin tocar el mes de origen. */
export function removeBudgetFromMonth(
  book: BudgetBook,
  target: PeriodKey,
  original: Pick<Budget, 'type' | 'category' | 'savingId'>,
  newId: () => string,
  index: PeriodIndex,
): BudgetBook {
  const safe = normalizeBook(book);
  if (!isMonthKey(target)) return book;

  const key = budgetKey(original);
  const budgets = materializeBudgets(safe.budgets, target, 'all', newId, index, safe.exclusions)
    .filter(b => !(b.period === target && budgetKey(b) === key));

  return { budgets, exclusions: withExclusion(safe.exclusions, target, key, true) };
}
