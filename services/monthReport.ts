import type { Budget, Saving } from '../types';
import type { PeriodIndex } from './periodIndex';
import { aggregatePeriod, categorySpent, periodHeadline, savingFlow, topCategories } from './periodIndex';
import { budgetStatus, budgetType } from './budgetPlan';
import type { BudgetType } from './budgetPlan';
import { isMonthKey, isYearKey, previousPeriod, shiftMonth } from './periods';
import type { PeriodKey } from './periods';

// Informe de Aura. Sustituye a los retos: en lugar de proponer objetivos que nadie
// mira, cuenta como va el mes y que categorias vigilar; y cuando el mes termina,
// lo resume. Todo se calcula aqui, en local y sin red. La IA solo redacta un
// comentario encima de este informe cuando el usuario lo pide.
//
// Es puro: la fecha de hoy entra como parametro para que el informe no dependa
// del reloj del dispositivo y se pueda probar.

export type ReportKind = 'progress' | 'summary' | 'future';

export interface Headline {
  income: number;
  expense: number;
  saving: number;
  result: number;
}

export interface WatchItem {
  category: string;
  type: BudgetType;
  spent: number;
  limit: number;
  status: 'over' | 'at-risk' | 'projected';
  /** Gasto previsto a final de periodo, solo en 'projected'. */
  projected?: number;
}

export interface MonthReport {
  period: PeriodKey;
  label: string;
  kind: ReportKind;
  /** Fraccion del periodo transcurrida (0..1). Solo en 'progress'. */
  pace: number | null;
  headline: Headline;
  previous: Headline;
  /** Media de los tres meses anteriores con actividad. null si no hay historia. */
  typical: Headline | null;
  expenseBudget: { limit: number; spent: number } | null;
  watch: WatchItem[];
  overCount: number;
  incomeGoal: { target: number; actual: number; met: boolean } | null;
  savingGoals: { total: number; met: number };
  unbudgeted: { category: string; amount: number } | null;
  txCount: number;
  /** Recordatorios del periodo. null si no se pasaron. */
  upcoming: { pending: number; amount: number; overdue: number } | null;
  lines: string[];
}

export interface MonthReportInput {
  period: PeriodKey;
  /** 'YYYY-MM-DD' */
  today: string;
  /** Presupuestos efectivos del periodo (con herencia ya resuelta). */
  budgets: Budget[];
  index: PeriodIndex;
  savings: Saving[];
  /**
   * Recordatorios del periodo, YA resumidos. Entran calculados para no acoplar
   * el informe al modulo de recordatorios: sin ellos, el informe es el de antes.
   */
  upcoming?: { pending: number; amount: number; overdue: number };
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Umbral de uso a partir del cual una categoria esta "al limite". */
export const AT_RISK_RATIO = 0.85;
/** Margen sobre el limite para avisar de que, a este ritmo, se va a pasar. */
export const PROJECTION_MARGIN = 1.1;
const MAX_WATCH = 3;

export function periodLabel(period: PeriodKey): string {
  if (isMonthKey(period)) return MONTHS[Number(period.slice(5, 7)) - 1] + ' ' + period.slice(0, 4);
  return period;
}

/**
 * Nombre del periodo con el que se compara, para ponerlo al lado de la cifra.
 *
 * El anio solo aparece cuando aporta algo: comparando septiembre de 2026 con
 * agosto de 2026 basta "Agosto"; contra agosto de 2025 hace falta el anio. La
 * comparativa decia "Entonces", que no nombra nada y obliga a mirar la cabecera.
 *
 * Va en mayuscula, al reves que periodLabel: es una etiqueta suelta y no una
 * pieza dentro de una frase.
 */
export function compareLabel(period: PeriodKey, reference: PeriodKey): string {
  if (!isMonthKey(period)) return period;
  const name = MONTHS[Number(period.slice(5, 7)) - 1];
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
  const sameYear = isMonthKey(reference) && reference.slice(0, 4) === period.slice(0, 4);
  return sameYear ? capitalized : capitalized + ' ' + period.slice(0, 4);
}

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export function daysInMonth(monthKey: string): number {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  if (month === 2) return isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].indexOf(month) !== -1 ? 30 : 31;
}

function kindAndPace(period: PeriodKey, today: string): { kind: ReportKind; pace: number | null } {
  const todayMonth = today.slice(0, 7);
  const day = Math.max(1, Number(today.slice(8, 10)) || 1);
  // Copia sin estrechar: isMonthKey es un type guard y dejaria la rama anual en never.
  const key: string = period;
  if (isMonthKey(period)) {
    if (key < todayMonth) return { kind: 'summary', pace: null };
    if (key > todayMonth) return { kind: 'future', pace: null };
    return { kind: 'progress', pace: Math.min(1, day / daysInMonth(key)) };
  }
  const year = today.slice(0, 4);
  if (key < year) return { kind: 'summary', pace: null };
  if (key > year) return { kind: 'future', pace: null };
  const monthIndex = Number(today.slice(5, 7)) - 1;
  return { kind: 'progress', pace: Math.min(1, (monthIndex + day / daysInMonth(todayMonth)) / 12) };
}

function typicalHeadline(index: PeriodIndex, period: PeriodKey): Headline | null {
  if (!isMonthKey(period)) return null;
  const picked: Headline[] = [];
  for (let i = 1; i <= 24 && picked.length < 3; i++) {
    const key = shiftMonth(period, -i);
    const month = index.months[key];
    if (month && month.txCount > 0) picked.push(periodHeadline(aggregatePeriod(index, key)));
  }
  if (!picked.length) return null;
  const sum = picked.reduce((acc, h) => ({
    income: acc.income + h.income,
    expense: acc.expense + h.expense,
    saving: acc.saving + h.saving,
    result: acc.result + h.result,
  }), { income: 0, expense: 0, saving: 0, result: 0 });
  const n = picked.length;
  return { income: sum.income / n, expense: sum.expense / n, saving: sum.saving / n, result: sum.result / n };
}

const euros = (value: number) => Math.round(value).toLocaleString('es-ES') + '€';
const signed = (value: number) => (value >= 0 ? '+' : '−') + euros(Math.abs(value));
const percent = (ratio: number) => Math.round(ratio * 100) + '%';

const SEVERITY: Record<WatchItem['status'], number> = { over: 0, 'at-risk': 1, projected: 2 };

export function buildMonthReport(input: MonthReportInput): MonthReport {
  const { period, today, index } = input;
  const budgets = Array.isArray(input.budgets) ? input.budgets : [];
  const savings = Array.isArray(input.savings) ? input.savings : [];
  const { kind, pace } = kindAndPace(period, today);

  const agg = aggregatePeriod(index, period);
  const headline = periodHeadline(agg);
  const previous = periodHeadline(aggregatePeriod(index, previousPeriod(period)));
  const typical = typicalHeadline(index, period);

  // Presupuestos de gasto: que se ha pasado, que esta al limite y que se va a pasar.
  const expenseBudgets = budgets.filter(b => budgetType(b) === 'expense');
  const candidates: (WatchItem & { weight: number })[] = [];
  let expenseLimit = 0;
  let expenseSpent = 0;
  let overCount = 0;
  for (let i = 0; i < expenseBudgets.length; i++) {
    const b = expenseBudgets[i];
    const spent = categorySpent(agg, b.category, 'expense');
    const limit = Number(b.limit) || 0;
    expenseLimit += limit;
    expenseSpent += spent;
    const base = { category: b.category, type: 'expense' as BudgetType, spent, limit };

    if (budgetStatus({ type: 'expense', spent, limit }) === 'over') {
      overCount++;
      candidates.push({ ...base, status: 'over', weight: limit > 0 ? spent / limit : Infinity });
      continue;
    }
    if (limit <= 0 || kind === 'future') continue;
    const ratio = spent / limit;
    if (ratio >= AT_RISK_RATIO) {
      candidates.push({ ...base, status: 'at-risk', weight: ratio });
      continue;
    }
    if (kind === 'progress' && pace !== null && pace >= 0.25 && pace < 1 && ratio >= 0.5) {
      const projected = spent / pace;
      if (projected > limit * PROJECTION_MARGIN) {
        candidates.push({ ...base, status: 'projected', projected, weight: projected / limit });
      }
    }
  }
  candidates.sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || b.weight - a.weight);
  const watch: WatchItem[] = candidates.slice(0, MAX_WATCH).map(({ weight, ...item }) => item);

  // Ingresos frente a lo previsto.
  const incomeBudgets = budgets.filter(b => budgetType(b) === 'income');
  const incomeTarget = incomeBudgets.reduce((s, b) => s + (Number(b.limit) || 0), 0);
  const incomeActual = incomeBudgets.reduce((s, b) => s + categorySpent(agg, b.category, 'income'), 0);
  const incomeGoal = incomeBudgets.length
    ? { target: incomeTarget, actual: incomeActual, met: incomeTarget > 0 && incomeActual >= incomeTarget }
    : null;

  // Objetivos de ahorro de huchas que siguen existiendo.
  const savingIds: Record<string, boolean> = {};
  savings.forEach(s => { savingIds[s.id] = true; });
  const goals = budgets.filter(b => budgetType(b) === 'saving' && !!b.savingId && savingIds[b.savingId]);
  const savingGoals = {
    total: goals.length,
    met: goals.filter(b => budgetStatus({ type: 'saving', spent: savingFlow(index, b.savingId as string, period).deposits, limit: b.limit }) === 'achieved').length,
  };

  // La categoria de gasto mas grande que no tiene presupuesto: el punto ciego.
  const budgeted: Record<string, boolean> = {};
  expenseBudgets.forEach(b => { budgeted[b.category] = true; });
  const blind = topCategories(agg, 'expense', 0).filter(row => !budgeted[row.category])[0];
  const unbudgeted = blind ? { category: blind.category, amount: blind.amount } : null;

  const report: MonthReport = {
    period,
    label: periodLabel(period),
    kind,
    pace,
    headline,
    previous,
    typical,
    expenseBudget: expenseBudgets.length ? { limit: expenseLimit, spent: expenseSpent } : null,
    watch,
    overCount,
    incomeGoal,
    savingGoals,
    unbudgeted,
    txCount: agg.txCount,
    upcoming: input.upcoming || null,
    lines: [],
  };
  report.lines = describe(report);
  return report;
}

/**
 * Lo que viene y todavia no ha pasado.
 *
 * El parentesis no es decorativo: sin el, la IA que redacta encima de este
 * informe leeria esa cifra como dinero ya gastado y aconsejaria sobre un mes que
 * no existe.
 */
function upcomingLine(r: MonthReport): string | null {
  const upcoming = r.upcoming;
  if (!upcoming || !upcoming.pending) return null;
  const cuantos = upcoming.pending === 1 ? '1 recordatorio' : upcoming.pending + ' recordatorios';
  let line = `Además tienes previstos ${euros(upcoming.amount)} en ${cuantos} que aún no has dado por pagados`;
  line += r.kind === 'future' ? '.' : ' (no están contados en el gasto de arriba).';
  if (upcoming.overdue > 0) {
    line += upcoming.overdue === 1
      ? ' Uno de ellos ya debería haber pasado.'
      : ` ${upcoming.overdue} de ellos ya deberían haber pasado.`;
  }
  return line;
}

function describe(r: MonthReport): string[] {
  const lines: string[] = [];

  if (r.kind === 'future') {
    lines.push(`${capitalize(r.label)} todavía no ha empezado.`);
    if (r.expenseBudget) lines.push(`Tienes ${euros(r.expenseBudget.limit)} presupuestados en gastos.`);
    if (r.incomeGoal) lines.push(`Esperas ingresar ${euros(r.incomeGoal.target)}.`);
    const aviso = upcomingLine(r);
    if (aviso) lines.push(aviso);
    return lines;
  }

  if (r.txCount === 0) {
    lines.push(r.kind === 'progress'
      ? `Aún no hay movimientos en ${r.label}.`
      : `No hubo movimientos en ${r.label}.`);
    const aviso = upcomingLine(r);
    if (aviso) lines.push(aviso);
    return lines;
  }

  if (r.kind === 'progress') {
    let line = `Llevas ${euros(r.headline.expense)} de gasto con el ${percent(r.pace || 0)} del periodo transcurrido.`;
    if (r.typical && r.typical.expense > 0 && isMonthKey(r.period)) line += ` Tu media es de ${euros(r.typical.expense)} al mes.`;
    lines.push(line);
    if (r.expenseBudget && r.expenseBudget.limit > 0 && r.pace !== null) {
      const used = r.expenseBudget.spent / r.expenseBudget.limit;
      lines.push(used > r.pace + 0.1
        ? `Has usado el ${percent(used)} del presupuesto de gasto: vas por encima del ritmo.`
        : `Has usado el ${percent(used)} del presupuesto de gasto: vas dentro del ritmo.`);
    }
  } else {
    let line = `Cerraste ${r.label} con un resultado de ${signed(r.headline.result)}`;
    line += isMonthKey(r.period) || isYearKey(r.period)
      ? ` (${signed(r.headline.result - r.previous.result)} frente al periodo anterior).`
      : '.';
    lines.push(line);
    lines.push(r.overCount > 0
      ? `Gastaste ${euros(r.headline.expense)} y te pasaste en ${r.overCount} presupuesto${r.overCount === 1 ? '' : 's'}.`
      : `Gastaste ${euros(r.headline.expense)} sin pasarte en ningún presupuesto.`);
  }

  if (r.incomeGoal && r.incomeGoal.target > 0) {
    lines.push(r.incomeGoal.met
      ? `Ingresos cumplidos: ${euros(r.incomeGoal.actual)} de ${euros(r.incomeGoal.target)}.`
      : `Ingresos: ${euros(r.incomeGoal.actual)} de ${euros(r.incomeGoal.target)} previstos.`);
  }

  let saving = `Has apartado ${euros(r.headline.saving)} en huchas`;
  if (r.savingGoals.total > 0) {
    saving += r.savingGoals.total === 1
      ? (r.savingGoals.met ? ' y has cumplido tu objetivo de ahorro.' : '; tu objetivo de ahorro sigue pendiente.')
      : ` (objetivos de ahorro cumplidos: ${r.savingGoals.met} de ${r.savingGoals.total}).`;
  } else {
    saving += '.';
  }
  lines.push(saving);

  if (r.kind === 'summary' && r.unbudgeted && lines.length < 5) {
    lines.push(`Tu mayor gasto sin presupuesto fue ${r.unbudgeted.category} (${euros(r.unbudgeted.amount)}).`);
  }

  // Lo que viene va al final: es una prevision, no un hecho del periodo.
  const aviso = upcomingLine(r);
  if (aviso) lines.push(aviso);

  return lines;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
