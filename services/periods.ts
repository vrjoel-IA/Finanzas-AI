// Utilidades de periodo. Todo es aritmetica de strings y enteros, sin Date, para
// que no dependa de la zona horaria del dispositivo: '2026-01' menos un mes tiene
// que dar '2025-12' en Madrid y en Tokio.

export type MonthKey = string; // 'YYYY-MM'
export type YearKey = string;  // 'YYYY'
export type PeriodKey = string;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^\d{4}$/;

export const isMonthKey = (key: unknown): key is MonthKey =>
  typeof key === 'string' && MONTH_RE.test(key);

export const isYearKey = (key: unknown): key is YearKey =>
  typeof key === 'string' && YEAR_RE.test(key);

export const isPeriodKey = (key: unknown): key is PeriodKey =>
  isMonthKey(key) || isYearKey(key);

const pad2 = (n: number): string => (n < 10 ? '0' + n : '' + n);

/** Mes al que pertenece una fecha ISO. Devuelve null si la fecha no es utilizable. */
export function monthKeyOfDate(date: unknown): MonthKey | null {
  if (typeof date !== 'string' || date.length < 7) return null;
  const key = date.slice(0, 7);
  return isMonthKey(key) ? key : null;
}

export const yearOfPeriod = (key: PeriodKey): string => key.slice(0, 4);

/** Desplaza un mes N posiciones. shiftMonth('2026-01', -1) === '2025-12'. */
export function shiftMonth(key: MonthKey, delta: number): MonthKey {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const total = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(total / 12);
  const newMonth = total - newYear * 12 + 1;
  return newYear + '-' + pad2(newMonth);
}

/** Periodo inmediatamente anterior, respetando el tipo de clave. */
export function previousPeriod(key: PeriodKey): PeriodKey {
  if (isMonthKey(key)) return shiftMonth(key, -1);
  if (isYearKey(key)) return String(Number(key) - 1);
  return key;
}

/** Mismo mes del anio anterior. Solo tiene sentido sobre claves de mes. */
export function sameMonthPreviousYear(key: MonthKey): MonthKey | null {
  if (!isMonthKey(key)) return null;
  return shiftMonth(key, -12);
}

/** Los doce meses de un anio, en orden. */
export function monthsOfYear(year: string): MonthKey[] {
  const months: MonthKey[] = [];
  for (let m = 1; m <= 12; m++) months.push(year + '-' + pad2(m));
  return months;
}

/** Los `count` meses que terminan en `endMonth`, del mas antiguo al mas reciente. */
export function monthRange(endMonth: MonthKey, count: number): MonthKey[] {
  if (!isMonthKey(endMonth) || count <= 0) return [];
  const keys: MonthKey[] = [];
  for (let i = count - 1; i >= 0; i--) keys.push(shiftMonth(endMonth, -i));
  return keys;
}

/**
 * Adapta currentDate al modo de vista. Sin esto, cambiar de mes a anio deja
 * currentDate en 'YYYY-MM' y la cabecera imprime "Anio 2026-10"; al volver a mes
 * se queda en 'YYYY' y la flecha de periodo salta a enero.
 */
export function normalizePeriodForView(
  key: PeriodKey,
  mode: 'month' | 'year',
  fallbackMonth?: MonthKey,
): PeriodKey {
  if (mode === 'year') return isYearKey(key) ? key : yearOfPeriod(key);
  if (isMonthKey(key)) return key;
  const year = yearOfPeriod(key);
  if (fallbackMonth && isMonthKey(fallbackMonth) && fallbackMonth.slice(0, 4) === year) {
    return fallbackMonth;
  }
  return year + '-01';
}
