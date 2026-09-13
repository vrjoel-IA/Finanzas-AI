import type { PeriodIndex } from './periodIndex';
import { monthSeries } from './periodIndex';
import type { MonthKey } from './periods';

// Proyeccion realista: cuanto se ahorra de verdad en un anio normal.
//
// La pantalla de Proyecciones simula el plan perfecto: se cumple la aportacion
// mensual todos los meses y no pasa nada raro. Esto es lo contrario: parte del
// historial real, donde ya estan los meses malos, la cena que se fue de precio y
// la revision del coche.
//
// Se usa la MEDIANA y no la media: una paga extra o un mes de mudanza mueven
// mucho la media y casi nada la mediana.

export interface MonthPoint {
  key: MonthKey;
  income: number;
  expense: number;
  netSavings: number;
}

export interface RealisticInput {
  months: MonthPoint[];
  seedLiquid: number;
  seedSavings: number;
  /** Rentabilidad anual media del capital ahorrado, en %. */
  annualGrowthRate?: number;
  years?: number;
  /** Inflacion anual aplicada al gasto, en %. El ingreso se mantiene nominal. */
  inflationRate?: number;
  /** Amplitud de la banda, en desviaciones tipicas. */
  volatilityK?: number;
  /**
   * Colchon extra de imprevistos por anio. Por defecto 0: el historial YA
   * incluye los imprevistos que has tenido, y restarlos otra vez seria contarlos
   * dos veces. Se expone para poder tensar el escenario a proposito.
   */
  contingencyPerYear?: number;
}

export interface ProjectionPoint {
  year: number;
  label: string;
  low: number;
  base: number;
  high: number;
}

export interface RealisticResult {
  /** Menos de 3 meses con movimiento: no hay con que estimar nada. */
  insufficientData: boolean;
  /** Entre 3 y 5 meses: se estima, pero la banda es poco fiable. */
  lowConfidence: boolean;
  monthsUsed: number;
  medianNetSavings: number;
  meanNetSavings: number;
  stdDevNetSavings: number;
  p25NetSavings: number;
  p75NetSavings: number;
  medianExpense: number;
  /** Cuanto se desvia un mes caro respecto al habitual. */
  irregularExpenseBuffer: number;
  /** Proporcion del ingreso que acaba ahorrada. */
  savingsRate: number;
  /** Ahorro estimado en los proximos doce meses. */
  oneYearEstimate: number;
  points: ProjectionPoint[];
}

const MIN_MONTHS = 3;
const LOW_CONFIDENCE_MONTHS = 6;

function sortedValues(values: number[]): number[] {
  return values.slice().sort((a, b) => a - b);
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = sortedValues(values);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Percentil por interpolacion lineal. p va de 0 a 1. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = sortedValues(values);
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  const mean = sum / values.length;
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - mean;
    acc += d * d;
  }
  return Math.sqrt(acc / (values.length - 1));
}

/** Extrae del indice los ultimos meses CON movimiento, del mas antiguo al mas reciente. */
export function buildMonthPoints(index: PeriodIndex, endMonth: MonthKey, count: number): MonthPoint[] {
  return monthSeries(index, endMonth, count)
    .filter(month => month.txCount > 0)
    .map(month => ({
      key: month.key,
      income: month.baseIncome,
      expense: month.netExpense,
      // Lo que de verdad queda al final del mes, este donde este: en la cuenta o
      // en una hucha. Las aportaciones a huchas no son gasto.
      netSavings: month.baseIncome - month.netExpense,
    }));
}

export function projectRealistic(input: RealisticInput): RealisticResult {
  const months = Array.isArray(input.months) ? input.months : [];
  const years = input.years && input.years > 0 ? Math.floor(input.years) : 20;
  const growth = Number(input.annualGrowthRate) || 0;
  const inflation = input.inflationRate === undefined ? 2.5 : Number(input.inflationRate) || 0;
  const k = input.volatilityK === undefined ? 1 : Number(input.volatilityK) || 0;
  const contingency = Number(input.contingencyPerYear) || 0;

  const savings = months.map(m => m.netSavings);
  const expenses = months.map(m => m.expense);
  const incomes = months.map(m => m.income);

  const medianNetSavings = median(savings);
  const meanNetSavings = savings.length
    ? savings.reduce((sum, v) => sum + v, 0) / savings.length
    : 0;
  const deviation = stdDev(savings);
  const medianExpense = median(expenses);
  const medianIncome = median(incomes);
  const p25 = percentile(savings, 0.25);
  const p75 = percentile(savings, 0.75);
  const irregularExpenseBuffer = Math.max(0, percentile(expenses, 0.75) - medianExpense);
  const savingsRate = medianIncome > 0 ? medianNetSavings / medianIncome : 0;

  const base: RealisticResult = {
    insufficientData: months.length < MIN_MONTHS,
    lowConfidence: months.length >= MIN_MONTHS && months.length < LOW_CONFIDENCE_MONTHS,
    monthsUsed: months.length,
    medianNetSavings,
    meanNetSavings,
    stdDevNetSavings: deviation,
    p25NetSavings: p25,
    p75NetSavings: p75,
    medianExpense,
    irregularExpenseBuffer,
    savingsRate,
    oneYearEstimate: medianNetSavings * 12,
    points: [],
  };

  if (base.insufficientData) return base;

  const scenarios = [
    { name: 'low' as const, monthly: medianNetSavings - k * deviation },
    { name: 'base' as const, monthly: medianNetSavings },
    { name: 'high' as const, monthly: medianNetSavings + k * deviation },
  ];

  const seedLiquid = Number(input.seedLiquid) || 0;
  const seedSavings = Number(input.seedSavings) || 0;
  const monthlyRate = growth / 100 / 12;

  const tracks: Record<string, number[]> = { low: [], base: [], high: [] };

  for (let s = 0; s < scenarios.length; s++) {
    const scenario = scenarios[s];
    let capital = seedSavings;
    const series: number[] = [seedLiquid + seedSavings]; // anio 0 = hoy, antes de capitalizar

    for (let year = 1; year <= years; year++) {
      // El gasto sube con la inflacion mientras el ingreso se mantiene nominal:
      // es la lectura conservadora, y con inflationRate 0 se desactiva.
      const inflationDrag = medianExpense * (Math.pow(1 + inflation / 100, year) - 1);
      const monthly = scenario.monthly - inflationDrag;
      for (let m = 0; m < 12; m++) capital = capital * (1 + monthlyRate) + monthly;
      capital -= contingency;
      series.push(seedLiquid + capital);
    }
    tracks[scenario.name] = series;
  }

  const points: ProjectionPoint[] = [];
  for (let year = 0; year <= years; year++) {
    const low = tracks.low[year];
    const high = tracks.high[year];
    points.push({
      year,
      label: year === 0 ? 'Hoy' : year + 'a',
      low: Math.round(Math.min(low, high)),
      base: Math.round(tracks.base[year]),
      high: Math.round(Math.max(low, high)),
    });
  }

  base.points = points;
  return base;
}
