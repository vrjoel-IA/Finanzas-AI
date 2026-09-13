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

const budgetType = (b: Budget): 'income' | 'expense' => (b.type === 'income' ? 'income' : 'expense');

/** Clave de identidad. Sin el tipo, un ingreso y un gasto de la misma categoria se pisan. */
export const budgetKey = (b: Budget): string => b.category + '|' + budgetType(b);

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
): EffectiveBudget[] {
  const list = Array.isArray(budgets) ? budgets : [];

  if (isYearKey(target)) return annualizeYear(list, target, index);

  const result: EffectiveBudget[] = [];
  const taken: Record<string, boolean> = {};

  const own = ownBudgets(list, target);
  for (let i = 0; i < own.length; i++) {
    const key = budgetKey(own[i]);
    if (taken[key]) continue;
    taken[key] = true;
    result.push(toEffective(own[i], 'own'));
  }

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
function annualizeYear(budgets: Budget[], year: string, index: PeriodIndex): EffectiveBudget[] {
  const months = monthsOfYear(year);
  const totals: Record<string, EffectiveBudget> = {};
  const order: string[] = [];

  for (let m = 0; m < months.length; m++) {
    const monthly = resolveEffectiveBudgets(budgets, months[m], index);
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
): Budget[] {
  if (!isMonthKey(target)) return budgets;

  const list = Array.isArray(budgets) ? budgets : [];
  const effective = resolveEffectiveBudgets(list, target, index);
  const wanted = categories === 'all' ? null : categories;

  const created: Budget[] = [];
  for (let i = 0; i < effective.length; i++) {
    const budget = effective[i];
    if (budget.origin === 'own') continue;
    if (wanted && wanted.indexOf(budget.category) === -1) continue;
    created.push({
      id: newId(),
      category: budget.category,
      limit: budget.limit,
      icon: budget.icon,
      spent: 0,
      type: budgetType(budget),
      color: budget.color,
      period: target,
    });
  }

  return created.length ? list.concat(created) : list;
}
