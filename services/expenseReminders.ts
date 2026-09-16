import type { ExpenseReminder, ReminderFulfilment, ReminderSchedule, Transaction } from '../types';
import type { MonthKey, PeriodKey } from './periods';
import { isMonthKey, isYearKey, monthsOfYear } from './periods';
import { classifyTransaction } from './txClassify';

// Recordatorios de gastos que vienen.
//
// No son presupuestos y no se parecen en nada a ellos: no limitan, no se restan
// de ningun total y NO CREAN NINGUN MOVIMIENTO. Solo avisan de que este mes hay
// un seguro, una cuota del gimnasio o el pAdel con los que a lo mejor no
// contabas, y se dan por cumplidos cuando el usuario lo dice.
//
// Dos decisiones de diseno que conviene no deshacer:
//
// 1. Se CALCULA, no se escribe. Que toque este mes se deduce de la cadencia cada
//    vez que se mira; navegar no escribe datos (mismo criterio que budgetPlan).
//
// 2. El cumplimiento se registra DENTRO del recordatorio, nunca como un campo de
//    la transaccion. Marcar una sugerencia obliga a operar sobre movimientos que
//    YA existen, y tocarlos pasaria por updateTransaction, que reescribe el
//    array entero y recalcula reembolsos. Asi, todo lo que se escribe cae dentro
//    de expenseReminders y el historial no se toca jamas.
//
// Es puro: la fecha de hoy entra como parametro.

const DAY_MS = 86400000;

export type ReminderState = 'pending' | 'done' | 'skipped';

export interface ReminderOccurrence {
  reminder: ExpenseReminder;
  month: MonthKey;
  /** Dia esperado, recortado a los dias reales del mes. null si no se fijo. */
  dueDay: number | null;
  /** 'YYYY-MM-DD'. null si el recordatorio no fija dia. */
  dueDate: string | null;
  state: ReminderState;
  fulfilment?: ReminderFulfilment;
  /** El movimiento enlazado ya no existe. Se avisa; no se corrige por las bravas. */
  danglingLink: boolean;
  /** Importe esperado. 0 si no se sabe. */
  amount: number;
  /** Dias hasta la fecha esperada. Negativo = ya deberia haber pasado. */
  daysAway: number | null;
  overdue: boolean;
}

export interface RemindersInput {
  reminders: ExpenseReminder[] | null | undefined;
  /** 'YYYY-MM' o 'YYYY'. */
  period: PeriodKey;
  /** 'YYYY-MM-DD'. Parametro, nunca new Date() aqui dentro. */
  today: string;
  /** Ids de movimiento que existen, para detectar enlaces rotos. Opcional. */
  knownTxIds?: Record<string, boolean>;
}

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export function daysInMonth(month: MonthKey): number {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  if (index === 2) return isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].indexOf(index) !== -1 ? 30 : 31;
}

const pad2 = (n: number) => (n < 10 ? '0' + n : '' + n);

function toUtc(date: string): number | null {
  if (!date || date.length < 10) return null;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

/** Cada cuantos meses se repite. 0 si es puntual. */
export function cadenceMonths(schedule: ReminderSchedule): number {
  if (!schedule) return 0;
  if (schedule.kind === 'monthly') return 1;
  if (schedule.kind === 'quarterly') return 3;
  if (schedule.kind === 'annual') return 12;
  return 0;
}

const monthIndex = (month: MonthKey): number => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

/** Mes en el que ancla la cadencia: el primero en que puede tocar. */
function anchorMonthIndex(reminder: ExpenseReminder): number | null {
  const schedule = reminder.schedule;
  if (!schedule) return null;
  if (schedule.kind === 'once') {
    const month = String(schedule.date || '').slice(0, 7);
    return isMonthKey(month) ? monthIndex(month) : null;
  }
  if (!isMonthKey(reminder.startMonth)) return null;
  const start = monthIndex(reminder.startMonth);
  if (schedule.kind === 'monthly') return start;

  const wanted = schedule.kind === 'annual' ? Number(schedule.month) : Number(schedule.anchorMonth);
  if (!wanted || wanted < 1 || wanted > 12) return start;
  const step = cadenceMonths(schedule);
  // El primer mes >= start cuyo mes natural cuadra con la cadencia.
  const startYear = Number(reminder.startMonth.slice(0, 4));
  let candidate = startYear * 12 + wanted - 1;
  while (candidate < start) candidate += step;
  return candidate;
}

/** Si el recordatorio toca en ese mes, sin mirar si ya se cumplio. */
export function occursIn(reminder: ExpenseReminder, month: MonthKey): boolean {
  if (!reminder || !isMonthKey(month) || reminder.archived) return false;
  const anchor = anchorMonthIndex(reminder);
  if (anchor === null) return false;

  const target = monthIndex(month);
  if (target < anchor) return false;
  if (isMonthKey(reminder.startMonth) && target < monthIndex(reminder.startMonth)) return false;
  if (isMonthKey(reminder.endMonth || '') && target > monthIndex(reminder.endMonth as string)) return false;

  const step = cadenceMonths(reminder.schedule);
  if (step === 0) return target === anchor;
  return (target - anchor) % step === 0;
}

function occurrenceOf(
  reminder: ExpenseReminder,
  month: MonthKey,
  today: string,
  knownTxIds?: Record<string, boolean>,
): ReminderOccurrence {
  const schedule = reminder.schedule;
  const rawDay = schedule && schedule.kind === 'once'
    ? Number(String(schedule.date || '').slice(8, 10))
    : (schedule && (schedule as any).day !== undefined ? Number((schedule as any).day) : NaN);

  const dueDay = rawDay && rawDay > 0 ? Math.min(rawDay, daysInMonth(month)) : null;
  const dueDate = dueDay ? month + '-' + pad2(dueDay) : null;

  const done = reminder.done || {};
  const fulfilment = done[month];
  const skipped = Array.isArray(reminder.skipped) && reminder.skipped.indexOf(month) !== -1;
  const state: ReminderState = fulfilment ? 'done' : skipped ? 'skipped' : 'pending';

  const dangling = !!(fulfilment && fulfilment.txId && knownTxIds && !knownTxIds[fulfilment.txId]);

  let daysAway: number | null = null;
  if (dueDate) {
    const due = toUtc(dueDate);
    const now = toUtc(today);
    if (due !== null && now !== null) daysAway = Math.round((due - now) / DAY_MS);
  }

  return {
    reminder,
    month,
    dueDay,
    dueDate,
    state,
    fulfilment,
    danglingLink: dangling,
    amount: Number(reminder.amount) || 0,
    daysAway,
    overdue: state === 'pending' && daysAway !== null && daysAway < 0,
  };
}

/**
 * Lo que toca en un periodo. Una clave de anio recorre sus doce meses.
 * Orden: primero lo que tiene fecha y antes vence, y a igualdad, mas importe.
 */
export function remindersForPeriod(input: RemindersInput): ReminderOccurrence[] {
  const reminders = Array.isArray(input.reminders) ? input.reminders : [];
  if (!reminders.length) return [];

  const months: MonthKey[] = isMonthKey(input.period)
    ? [input.period as MonthKey]
    : isYearKey(input.period) ? monthsOfYear(input.period) : [];
  if (!months.length) return [];

  const out: ReminderOccurrence[] = [];
  for (let m = 0; m < months.length; m++) {
    for (let r = 0; r < reminders.length; r++) {
      if (occursIn(reminders[r], months[m])) {
        out.push(occurrenceOf(reminders[r], months[m], input.today, input.knownTxIds));
      }
    }
  }

  return out.sort((a, b) => {
    if (a.month !== b.month) return a.month < b.month ? -1 : 1;
    if (a.dueDay !== b.dueDay) {
      if (a.dueDay === null) return 1;
      if (b.dueDay === null) return -1;
      return a.dueDay - b.dueDay;
    }
    return b.amount - a.amount;
  });
}

export interface ReminderSummary {
  total: number;
  pending: number;
  done: number;
  skipped: number;
  /** Suma de lo que se espera pagar y aun no se ha dado por cumplido. */
  pendingAmount: number;
  doneAmount: number;
  overdue: number;
}

export function summarizeReminders(occurrences: ReminderOccurrence[]): ReminderSummary {
  const summary: ReminderSummary = {
    total: 0, pending: 0, done: 0, skipped: 0, pendingAmount: 0, doneAmount: 0, overdue: 0,
  };
  if (!Array.isArray(occurrences)) return summary;

  for (let i = 0; i < occurrences.length; i++) {
    const occurrence = occurrences[i];
    summary.total++;
    if (occurrence.state === 'pending') {
      summary.pending++;
      summary.pendingAmount += occurrence.amount;
      if (occurrence.overdue) summary.overdue++;
    } else if (occurrence.state === 'done') {
      summary.done++;
      const paid = occurrence.fulfilment && occurrence.fulfilment.amount !== undefined
        ? Number(occurrence.fulfilment.amount) || 0
        : occurrence.amount;
      summary.doneAmount += paid;
    } else {
      summary.skipped++;
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Escrituras. Todas devuelven un array nuevo de recordatorios y NADA MAS: este
// modulo no tiene forma de tocar transacciones ni cuentas.
// ---------------------------------------------------------------------------

const mapOne = (
  reminders: ExpenseReminder[] | null | undefined,
  id: string,
  change: (r: ExpenseReminder) => ExpenseReminder,
): ExpenseReminder[] => {
  const list = Array.isArray(reminders) ? reminders : [];
  return list.map(reminder => (reminder.id === id ? change(reminder) : reminder));
};

export function markDone(
  reminders: ExpenseReminder[] | null | undefined,
  reminderId: string,
  month: MonthKey,
  fulfilment: ReminderFulfilment,
): ExpenseReminder[] {
  if (!isMonthKey(month)) return Array.isArray(reminders) ? reminders : [];
  return mapOne(reminders, reminderId, reminder => ({
    ...reminder,
    done: { ...(reminder.done || {}), [month]: fulfilment },
    // Dar por hecho un mes y tenerlo saltado a la vez no significa nada.
    skipped: (reminder.skipped || []).filter(key => key !== month),
  }));
}

export function clearDone(
  reminders: ExpenseReminder[] | null | undefined,
  reminderId: string,
  month: MonthKey,
): ExpenseReminder[] {
  return mapOne(reminders, reminderId, reminder => {
    const done = { ...(reminder.done || {}) };
    delete done[month];
    return { ...reminder, done };
  });
}

export function skipMonth(
  reminders: ExpenseReminder[] | null | undefined,
  reminderId: string,
  month: MonthKey,
  skipped: boolean,
): ExpenseReminder[] {
  if (!isMonthKey(month)) return Array.isArray(reminders) ? reminders : [];
  return mapOne(reminders, reminderId, reminder => {
    const list = (reminder.skipped || []).filter(key => key !== month);
    return { ...reminder, skipped: skipped ? list.concat([month]) : list };
  });
}

/** Una sugerencia rechazada no vuelve a proponerse para ese mes. */
export function rejectMatch(
  reminders: ExpenseReminder[] | null | undefined,
  reminderId: string,
  month: MonthKey,
  txId: string,
): ExpenseReminder[] {
  return mapOne(reminders, reminderId, reminder => {
    const rejected = { ...(reminder.rejected || {}) };
    const current = rejected[month] || [];
    if (current.indexOf(txId) === -1) rejected[month] = current.concat([txId]);
    return { ...reminder, rejected };
  });
}

export function upsertReminder(
  reminders: ExpenseReminder[] | null | undefined,
  reminder: ExpenseReminder,
): ExpenseReminder[] {
  const list = Array.isArray(reminders) ? reminders : [];
  return list.some(r => r.id === reminder.id)
    ? list.map(r => (r.id === reminder.id ? reminder : r))
    : list.concat([reminder]);
}

export function removeReminder(
  reminders: ExpenseReminder[] | null | undefined,
  reminderId: string,
): ExpenseReminder[] {
  const list = Array.isArray(reminders) ? reminders : [];
  return list.filter(reminder => reminder.id !== reminderId);
}

// ---------------------------------------------------------------------------
// Emparejamiento sugerido.
//
// Propone, nunca decide. El usuario eligio expresamente "sugerencia + confirmas
// tu": un falso positivo que se diera por bueno solo esconderia un aviso que si
// hacia falta.
// ---------------------------------------------------------------------------

export interface MatchTolerance {
  /** Margen relativo sobre el importe esperado. Un seguro sube con el IPC. */
  amountRatio: number;
  /** Margen absoluto minimo en euros, para que los importes pequenos respiren. */
  amountFloor: number;
  /** Dias arriba y abajo de la fecha esperada. Los domiciliados se mueven. */
  dayWindow: number;
  /** Puntuacion minima para proponer algo. */
  minScore: number;
}

export const DEFAULT_TOLERANCE: MatchTolerance = {
  amountRatio: 0.15,
  amountFloor: 5,
  dayWindow: 10,
  minScore: 0.6,
};

export const MAX_CANDIDATES = 3;

export interface MatchCandidate {
  tx: Transaction;
  /** 0..1 */
  score: number;
  reasons: ('category' | 'amount' | 'date' | 'name')[];
}

export interface MatchInput {
  occurrence: ReminderOccurrence;
  /** Movimientos del mes. El servicio no recorre el historial entero. */
  transactions: Transaction[];
  /** Ya enlazados a otro recordatorio ese mes: no se vuelven a proponer. */
  usedTxIds?: string[];
  tolerance?: MatchTolerance;
}

const ACCENTS: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n' };

export function normalizeText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[áéíóúüñ]/g, ch => ACCENTS[ch] || ch)
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Comparten alguna palabra de cuatro letras o mas. */
export function sharesToken(a: string, b: string): boolean {
  const left = normalizeText(a).split(' ').filter(word => word.length >= 4);
  if (!left.length) return false;
  const right = normalizeText(b).split(' ').filter(word => word.length >= 4);
  if (!right.length) return false;
  return left.some(word => right.indexOf(word) !== -1);
}

/** 1 en el centro, decayendo hasta 0 en el borde de la tolerancia. */
const gradient = (distance: number, free: number, limit: number): number => {
  if (limit <= free) return distance <= free ? 1 : 0;
  if (distance <= free) return 1;
  if (distance >= limit) return 0;
  return 1 - (distance - free) / (limit - free);
};

export function suggestMatches(input: MatchInput): MatchCandidate[] {
  const tolerance = input.tolerance || DEFAULT_TOLERANCE;
  const occurrence = input.occurrence;
  if (!occurrence || occurrence.state !== 'pending') return [];

  const reminder = occurrence.reminder;
  const transactions = Array.isArray(input.transactions) ? input.transactions : [];
  const used = input.usedTxIds || [];
  const rejected = (reminder.rejected || {})[occurrence.month] || [];

  const expected = Number(reminder.amount) || 0;
  const amountLimit = Math.max(expected * tolerance.amountRatio, tolerance.amountFloor);
  const dueMs = occurrence.dueDate ? toUtc(occurrence.dueDate) : null;

  // La puntuacion se normaliza por las senales que ESTE recordatorio puede
  // ofrecer. Uno sin importe esperado nunca llegaria al umbral si el importe
  // siguiera pesando 0.35 en el denominador, y se quedaria mudo para siempre.
  const available = (reminder.category ? 0.4 : 0) + (expected > 0 ? 0.35 : 0) + 0.15 + 0.1;

  const candidates: MatchCandidate[] = [];

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    if (!tx || !tx.id) continue;
    if (used.indexOf(tx.id) !== -1 || rejected.indexOf(tx.id) !== -1) continue;
    // Solo gastos de verdad: una aportacion a hucha, un traspaso o el cobro de
    // un reembolso nunca son el pago de un seguro.
    if (classifyTransaction(tx) !== 'expense') continue;
    if (String(tx.date || '').slice(0, 7) !== occurrence.month) continue;

    const reasons: MatchCandidate['reasons'] = [];
    let score = 0;

    if (reminder.category && tx.category === reminder.category) {
      score += 0.4;
      reasons.push('category');
    }

    if (expected > 0) {
      const distance = Math.abs((Number(tx.amount) || 0) - expected);
      const free = Math.max(expected * 0.03, 1);
      const closeness = gradient(distance, free, amountLimit);
      if (closeness > 0) {
        score += 0.35 * closeness;
        if (closeness > 0.5) reasons.push('amount');
      }
    }

    if (dueMs !== null) {
      const txMs = toUtc(tx.date);
      if (txMs !== null) {
        const days = Math.abs(Math.round((txMs - dueMs) / DAY_MS));
        const closeness = gradient(days, 2, tolerance.dayWindow);
        if (closeness > 0) {
          score += 0.15 * closeness;
          if (closeness > 0.5) reasons.push('date');
        }
      }
    } else {
      // Sin dia fijado, cualquier dia del mes vale: ya se ha filtrado por mes.
      score += 0.15;
    }

    if (sharesToken(reminder.name, tx.description)) {
      score += 0.1;
      reasons.push('name');
    }

    // La fecha sola nunca propone: si coincidir en el dia bastara, cualquier
    // cargo de ese dia saldria como candidato y la sugerencia seria ruido.
    const hasStrongSignal = reasons.indexOf('category') !== -1
      || reasons.indexOf('amount') !== -1
      || reasons.indexOf('name') !== -1;
    const normalized = available > 0 ? score / available : 0;
    if (hasStrongSignal && normalized >= tolerance.minScore) {
      candidates.push({ tx, score: normalized, reasons });
    }
  }

  return candidates
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : (a.tx.id < b.tx.id ? -1 : 1)))
    .slice(0, MAX_CANDIDATES);
}

export interface DraftLike {
  amount: number;
  /** 'YYYY-MM-DD' */
  date: string;
  category: string;
  description: string;
}

export interface ReminderSuggestion {
  reminder: ExpenseReminder;
  month: MonthKey;
  score: number;
}

/**
 * El camino inverso: mientras das de alta un gasto, que recordatorios podria
 * estar cerrando. Nada viene preseleccionado; es el usuario quien enlaza.
 */
export function suggestRemindersForDraft(
  reminders: ExpenseReminder[] | null | undefined,
  draft: DraftLike,
  today: string,
  tolerance?: MatchTolerance,
): ReminderSuggestion[] {
  const list = Array.isArray(reminders) ? reminders : [];
  const month = String(draft && draft.date ? draft.date : '').slice(0, 7);
  if (!isMonthKey(month) || !list.length) return [];

  const tx: Transaction = {
    id: 'borrador',
    date: draft.date,
    amount: Number(draft.amount) || 0,
    description: draft.description || '',
    category: draft.category || '',
    type: 'expense',
    accountId: '',
    isRefund: false,
  };

  const out: ReminderSuggestion[] = [];
  for (let i = 0; i < list.length; i++) {
    const reminder = list[i];
    if (!occursIn(reminder, month as MonthKey)) continue;
    const occurrence = occurrenceOf(reminder, month as MonthKey, today);
    if (occurrence.state !== 'pending') continue;
    const matches = suggestMatches({ occurrence, transactions: [tx], tolerance });
    if (matches.length) out.push({ reminder, month: month as MonthKey, score: matches[0].score });
  }

  return out.sort((a, b) => b.score - a.score);
}
