import type { Transaction } from '../types';
import { classifyTransaction } from './txClassify';
import { isMonthKey, isYearKey, monthKeyOfDate, monthRange } from './periods';
import type { MonthKey, PeriodKey } from './periods';

// Indice mensual: un unico recorrido sobre las transacciones que alimenta
// comparativas, anillo de categorias, graficos y proyeccion realista. Antes cada
// widget recorria el historial entero por su cuenta, varias veces por render.
//
// Solo depende de `transactions`. Los saldos iniciales de cuentas y huchas se
// suman fuera, de modo que el indice se puede reconstruir ponderado (cuenta
// conjunta) sin recalcular nada mas.

export interface CategoryFlow {
  expense: number;   // gasto bruto
  income: number;    // ingreso real, sin reembolsos
  refunded: number;  // ingresos ligados a un reembolso
  count: number;
}

export interface PeriodAggregate {
  key: PeriodKey;
  baseIncome: number;
  refundRecoveries: number;
  baseExpense: number;
  /** Gasto neto de reembolsos. Sin recortar a cero: el consumidor decide. */
  netExpense: number;
  savingDeposits: number;
  savingWithdrawals: number;
  netResult: number;
  byCategory: Record<string, CategoryFlow>;
  txCount: number;
}

export interface MonthAggregate extends PeriodAggregate {
  key: MonthKey;
  /** Variacion de saldo del mes por cuenta. Incluye traspasos. */
  netFlowByAccount: Record<string, number>;
  /** Variacion de la hucha: una aportacion (expense) suma, una retirada resta. */
  netFlowBySaving: Record<string, number>;
  /** Aportaciones y retiradas brutas por hucha, para los objetivos de ahorro. */
  depositsBySaving: Record<string, number>;
  withdrawalsBySaving: Record<string, number>;
}

export interface PeriodIndex {
  months: Record<MonthKey, MonthAggregate>;
  /** Meses con actividad, ascendente. */
  monthKeys: MonthKey[];
  firstMonth: MonthKey | null;
  lastMonth: MonthKey | null;
  /** Acumulados al cierre de monthKeys[i]. Son deltas: no incluyen saldo inicial. */
  cumByAccount: Record<string, number[]>;
  cumBySaving: Record<string, number[]>;
  weighted: boolean;
  skipped: number; // transacciones descartadas por fecha inservible
}

export interface IndexWeights {
  /** accountId -> 0..1. Ausente o sin entrada = 1. */
  accounts?: Record<string, number>;
  /** savingId -> 0..1. */
  savings?: Record<string, number>;
}

const emptyCategoryFlow = (): CategoryFlow => ({ expense: 0, income: 0, refunded: 0, count: 0 });

export function emptyAggregate(key: PeriodKey): PeriodAggregate {
  return {
    key,
    baseIncome: 0,
    refundRecoveries: 0,
    baseExpense: 0,
    netExpense: 0,
    savingDeposits: 0,
    savingWithdrawals: 0,
    netResult: 0,
    byCategory: {},
    txCount: 0,
  };
}

const emptyMonth = (key: MonthKey): MonthAggregate => {
  const base = emptyAggregate(key) as MonthAggregate;
  base.netFlowByAccount = {};
  base.netFlowBySaving = {};
  base.depositsBySaving = {};
  base.withdrawalsBySaving = {};
  return base;
};

function finishAggregate<T extends PeriodAggregate>(agg: T): T {
  agg.netExpense = agg.baseExpense - agg.refundRecoveries;
  agg.netResult = agg.baseIncome + agg.savingWithdrawals - agg.netExpense - agg.savingDeposits;
  return agg;
}

function weightOf(table: Record<string, number> | undefined, id: string | undefined): number {
  if (!table || !id) return 1;
  const w = table[id];
  return typeof w === 'number' && isFinite(w) ? w : 1;
}

function addCategory(
  agg: PeriodAggregate,
  category: string,
  field: 'expense' | 'income' | 'refunded',
  amount: number,
): void {
  const name = category || 'Sin categoria';
  let bucket = agg.byCategory[name];
  if (!bucket) {
    bucket = emptyCategoryFlow();
    agg.byCategory[name] = bucket;
  }
  bucket[field] += amount;
  bucket.count += 1;
}

/** Construye el indice. No muta el array recibido ni ninguna transaccion: solo lee. */
export function buildPeriodIndex(transactions: Transaction[], weights?: IndexWeights): PeriodIndex {
  const months: Record<MonthKey, MonthAggregate> = {};
  const accountIds: string[] = [];
  const savingIds: string[] = [];
  const seenAccounts: Record<string, boolean> = {};
  const seenSavings: Record<string, boolean> = {};
  let skipped = 0;

  const list = Array.isArray(transactions) ? transactions : [];

  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t) { skipped++; continue; }
    const key = monthKeyOfDate(t.date);
    if (!key) { skipped++; continue; }

    const raw = Number(t.amount);
    const base = isFinite(raw) ? raw : 0;
    const amount = base * weightOf(weights && weights.accounts, t.accountId);

    let agg = months[key];
    if (!agg) {
      agg = emptyMonth(key);
      months[key] = agg;
    }
    agg.txCount += 1;

    // El saldo de la cuenta se mueve con TODAS las transacciones, traspasos incluidos.
    if (t.accountId) {
      if (!seenAccounts[t.accountId]) { seenAccounts[t.accountId] = true; accountIds.push(t.accountId); }
      agg.netFlowByAccount[t.accountId] =
        (agg.netFlowByAccount[t.accountId] || 0) + (t.type === 'income' ? amount : -amount);
    }
    if (t.savingId) {
      if (!seenSavings[t.savingId]) { seenSavings[t.savingId] = true; savingIds.push(t.savingId); }
      const savingDelta = base * weightOf(weights && weights.savings, t.savingId);
      agg.netFlowBySaving[t.savingId] =
        (agg.netFlowBySaving[t.savingId] || 0) + (t.type === 'expense' ? savingDelta : -savingDelta);
      const bucket = t.type === 'expense' ? agg.depositsBySaving : agg.withdrawalsBySaving;
      bucket[t.savingId] = (bucket[t.savingId] || 0) + savingDelta;
    }

    switch (classifyTransaction(t)) {
      case 'income':
        agg.baseIncome += amount;
        addCategory(agg, t.category, 'income', amount);
        break;
      case 'expense':
        agg.baseExpense += amount;
        addCategory(agg, t.category, 'expense', amount);
        break;
      case 'refundRecovery':
        agg.refundRecoveries += amount;
        addCategory(agg, t.category, 'refunded', amount);
        break;
      case 'savingDeposit':
        agg.savingDeposits += amount;
        break;
      case 'savingWithdrawal':
        agg.savingWithdrawals += amount;
        break;
      default:
        // Los traspasos ya han movido el saldo y no son ingreso ni gasto.
        break;
    }
  }

  const monthKeys = Object.keys(months).sort();
  for (let i = 0; i < monthKeys.length; i++) finishAggregate(months[monthKeys[i]]);

  // Acumulados con relleno hacia delante, para consultar el saldo a cierre de
  // cualquier periodo con una busqueda binaria en lugar de recorrer el historial.
  const cumByAccount: Record<string, number[]> = {};
  const cumBySaving: Record<string, number[]> = {};
  const runningAccounts: Record<string, number> = {};
  const runningSavings: Record<string, number> = {};
  for (let a = 0; a < accountIds.length; a++) { cumByAccount[accountIds[a]] = []; runningAccounts[accountIds[a]] = 0; }
  for (let s = 0; s < savingIds.length; s++) { cumBySaving[savingIds[s]] = []; runningSavings[savingIds[s]] = 0; }

  for (let i = 0; i < monthKeys.length; i++) {
    const month = months[monthKeys[i]];
    for (let a = 0; a < accountIds.length; a++) {
      const id = accountIds[a];
      runningAccounts[id] += month.netFlowByAccount[id] || 0;
      cumByAccount[id].push(runningAccounts[id]);
    }
    for (let s = 0; s < savingIds.length; s++) {
      const id = savingIds[s];
      runningSavings[id] += month.netFlowBySaving[id] || 0;
      cumBySaving[id].push(runningSavings[id]);
    }
  }

  return {
    months,
    monthKeys,
    firstMonth: monthKeys.length ? monthKeys[0] : null,
    lastMonth: monthKeys.length ? monthKeys[monthKeys.length - 1] : null,
    cumByAccount,
    cumBySaving,
    weighted: !!weights,
    skipped,
  };
}

function mergeInto(target: PeriodAggregate, source: PeriodAggregate): void {
  target.baseIncome += source.baseIncome;
  target.refundRecoveries += source.refundRecoveries;
  target.baseExpense += source.baseExpense;
  target.savingDeposits += source.savingDeposits;
  target.savingWithdrawals += source.savingWithdrawals;
  target.txCount += source.txCount;
  const names = Object.keys(source.byCategory);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const from = source.byCategory[name];
    let into = target.byCategory[name];
    if (!into) {
      into = emptyCategoryFlow();
      target.byCategory[name] = into;
    }
    into.expense += from.expense;
    into.income += from.income;
    into.refunded += from.refunded;
    into.count += from.count;
  }
}

/** Agregado de un periodo. Una clave de anio suma sus doce meses. Nunca devuelve undefined. */
export function aggregatePeriod(index: PeriodIndex, key: PeriodKey): PeriodAggregate {
  if (isMonthKey(key)) {
    const month = index.months[key];
    const copy = emptyAggregate(key);
    if (month) mergeInto(copy, month);
    return finishAggregate(copy);
  }
  if (isYearKey(key)) {
    const total = emptyAggregate(key);
    for (let i = 0; i < index.monthKeys.length; i++) {
      const monthKey = index.monthKeys[i];
      if (monthKey.slice(0, 4) === key) mergeInto(total, index.months[monthKey]);
    }
    return finishAggregate(total);
  }
  return emptyAggregate(key);
}

/** Serie mensual continua: los meses sin actividad salen a cero, no se saltan. */
export function monthSeries(index: PeriodIndex, endMonth: MonthKey, count: number): MonthAggregate[] {
  return monthRange(endMonth, count).map(key => index.months[key] || emptyMonth(key));
}

function cutoffMonth(key: PeriodKey): MonthKey | null {
  if (isMonthKey(key)) return key;
  if (isYearKey(key)) return key + '-12';
  return null;
}

function cumulativeAt(series: number[] | undefined, monthKeys: MonthKey[], key: PeriodKey): number {
  if (!series || !series.length) return 0;
  const cutoff = cutoffMonth(key);
  if (!cutoff) return 0;
  // Busqueda binaria del ultimo mes con actividad anterior o igual al corte.
  let low = 0;
  let high = monthKeys.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (monthKeys[mid] <= cutoff) { found = mid; low = mid + 1; } else { high = mid - 1; }
  }
  return found >= 0 ? series[found] : 0;
}

/** Variacion acumulada del saldo de una cuenta hasta el cierre del periodo. */
export function accountDeltaAt(index: PeriodIndex, accountId: string, key: PeriodKey): number {
  return cumulativeAt(index.cumByAccount[accountId], index.monthKeys, key);
}

/** Variacion acumulada de una hucha hasta el cierre del periodo. */
export function savingDeltaAt(index: PeriodIndex, savingId: string, key: PeriodKey): number {
  return cumulativeAt(index.cumBySaving[savingId], index.monthKeys, key);
}

/**
 * Gasto (o ingreso) imputable a una categoria con la semantica de presupuestos:
 * en gasto se descuentan los reembolsos cobrados de esa misma categoria.
 */
export function categorySpent(agg: PeriodAggregate, category: string, type: 'income' | 'expense'): number {
  const bucket = agg.byCategory[category];
  if (!bucket) return 0;
  return type === 'income' ? bucket.income : bucket.expense - bucket.refunded;
}

/** Categorias de gasto (neto) o de ingreso ordenadas de mayor a menor. */
export function topCategories(
  agg: PeriodAggregate,
  type: 'income' | 'expense',
  limit: number,
): { category: string; amount: number }[] {
  const rows = Object.keys(agg.byCategory)
    .map(category => ({ category, amount: categorySpent(agg, category, type) }))
    .filter(row => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  return limit > 0 ? rows.slice(0, limit) : rows;
}

/** Categorias ordenadas por gasto neto descendente. */
export function topExpenseCategories(agg: PeriodAggregate, limit: number): { category: string; amount: number }[] {
  return topCategories(agg, 'expense', limit);
}

/**
 * Las cuatro cifras de un periodo con las MISMAS definiciones que el widget
 * principal del dashboard. La comparativa y la grafica mes a mes usaban el
 * resultado del mes como "Ahorro", que no es lo que el usuario ve arriba:
 *  - ingresos: ingreso real mas lo retirado de huchas (vuelve a la liquidez),
 *  - gastos: gasto neto de reembolsos, nunca negativo,
 *  - ahorro: dinero movido a huchas,
 *  - resultado: variacion de liquidez del periodo.
 */
export function periodHeadline(agg: PeriodAggregate): { income: number; expense: number; saving: number; result: number } {
  return {
    income: agg.baseIncome + agg.savingWithdrawals,
    expense: Math.max(0, agg.netExpense),
    saving: agg.savingDeposits,
    result: agg.netResult,
  };
}

/** Aportado y retirado de una hucha en un mes o un anio. */
export function savingFlow(index: PeriodIndex, savingId: string, key: PeriodKey): { deposits: number; withdrawals: number } {
  const flow = { deposits: 0, withdrawals: 0 };
  const add = (month: MonthAggregate | undefined) => {
    if (!month) return;
    flow.deposits += (month.depositsBySaving && month.depositsBySaving[savingId]) || 0;
    flow.withdrawals += (month.withdrawalsBySaving && month.withdrawalsBySaving[savingId]) || 0;
  };
  if (isMonthKey(key)) add(index.months[key]);
  else if (isYearKey(key)) {
    for (let i = 0; i < index.monthKeys.length; i++) {
      if (index.monthKeys[i].slice(0, 4) === key) add(index.months[index.monthKeys[i]]);
    }
  }
  return flow;
}
