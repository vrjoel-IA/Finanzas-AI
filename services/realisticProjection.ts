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

/** Un mes con ingreso muy por encima de lo habitual: paga extra, bonus, atrasos. */
export interface ExtraIncomeMonth {
  key: MonthKey;
  income: number;
  /** Cuanto supera el ingreso de ese mes al del mes tipico. */
  incomeExcess: number;
  /** Cuanto de ese exceso acabo quedandose de verdad. Nunca negativo. */
  savedExcess: number;
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
  /** Cuanto tiene que superar el ingreso al mes tipico para ser "extra". Por defecto 1.25. */
  extraIncomeRatio?: number;
  /** Suelo absoluto en euros para lo mismo. Por defecto 200. */
  extraIncomeFloor?: number;
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
  /** Ingreso del mes tipico. */
  medianIncome: number;
  /**
   * Desviacion de los meses NORMALES, sin los de ingreso extra. Es la que dibuja
   * la banda: una paga extra no es "un mes bueno", es otra categoria de mes, y
   * metiendola aqui ensanchaba la banda y hundia el escenario pesimista.
   */
  stdDevTypical: number;
  /** Pagas extra, bonus o atrasos detectados en la ventana observada. */
  extraIncomeMonths: ExtraIncomeMonth[];
  /** Suma de savedExcess observada en la ventana. */
  extraSavedObserved: number;
  /** La misma cifra llevada a doce meses. 0 si no hay historial suficiente. */
  extraSavedPerYear: number;
  /** Los ingresos han cambiado de nivel (una subida), no hay pagas extra que aislar. */
  incomeLevelChanged: boolean;
  /** Doce meses normales, sin extras: medianNetSavings * 12. */
  typicalYearEstimate: number;
  /** Ahorro estimado en los proximos doce meses: los doce meses normales mas los extras. */
  oneYearEstimate: number;
  points: ProjectionPoint[];
}

const MIN_MONTHS = 3;
const LOW_CONFIDENCE_MONTHS = 6;

// Deteccion de pagas extra.
//
// La mediana describe el mes normal, y eso esta bien: un mes raro no debe mover
// la cifra de "lo que ahorro al mes". Pero la estimacion ANUAL calculada como
// mediana x 12 se deja fuera las pagas extra, y entonces no es realista: es un
// suelo. Aqui se aislan esos meses para poder sumarlos aparte.

/** Cuanto tiene que superar el ingreso al del mes tipico. Una paga extra dobla la nomina. */
export const EXTRA_INCOME_RATIO = 1.25;
/** Suelo en euros: con una mediana baja, el 25% son cuatro duros y entraria cualquier venta suelta. */
export const EXTRA_INCOME_FLOOR = 200;
/** Por debajo de esto la mediana se calcula sobre muy pocos puntos y anualizar multiplica el error. */
export const EXTRA_MIN_MONTHS = 6;
/**
 * Si mas de un tercio de los meses sale "extra", no hay pagas extra: es que el
 * ingreso ha cambiado de nivel (una subida de sueldo). Dos pagas extra al anio
 * son 2 de 12, asi que el umbral deja sitio de sobra.
 */
export const EXTRA_MAX_SHARE = 0.34;

/**
 * Aisla los meses de ingreso atipico y calcula cuanto de ese exceso se quedo.
 *
 * Lo que se suma NO es el exceso de ingreso, es el exceso de AHORRO: si entran
 * 1.400 de paga extra y ese mes se pagan 500 del seguro, lo que se queda en el
 * patrimonio son 900. Con suelo en 0 (paga extra gastada entera: suma nada) y
 * techo en el propio exceso de ingreso (un mes de gasto bajo no es merito de la
 * paga extra).
 */
export function detectExtraIncomeMonths(
  months: MonthPoint[],
  medianIncome: number,
  medianNetSavings: number,
  ratio: number = EXTRA_INCOME_RATIO,
  floor: number = EXTRA_INCOME_FLOOR,
): { extras: ExtraIncomeMonth[]; incomeLevelChanged: boolean } {
  const none = { extras: [] as ExtraIncomeMonth[], incomeLevelChanged: false };
  if (!Array.isArray(months) || months.length < EXTRA_MIN_MONTHS) return none;
  if (!(medianIncome > 0)) return none;

  const extras: ExtraIncomeMonth[] = [];
  for (let i = 0; i < months.length; i++) {
    const month = months[i];
    const income = Number(month.income) || 0;
    const incomeExcess = income - medianIncome;
    if (income < medianIncome * ratio || incomeExcess < floor) continue;
    const savingsExcess = (Number(month.netSavings) || 0) - medianNetSavings;
    const savedExcess = Math.max(0, Math.min(savingsExcess, incomeExcess));
    extras.push({ key: month.key, income, incomeExcess, savedExcess });
  }

  if (extras.length > months.length * EXTRA_MAX_SHARE) {
    return { extras: [], incomeLevelChanged: true };
  }
  return { extras, incomeLevelChanged: false };
}

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

  // Los meses de paga extra se apartan: no ensanchan la banda y su exceso de
  // ahorro se suma aparte, una vez al anio.
  const ratio = input.extraIncomeRatio === undefined ? EXTRA_INCOME_RATIO : Number(input.extraIncomeRatio) || EXTRA_INCOME_RATIO;
  const floor = input.extraIncomeFloor === undefined ? EXTRA_INCOME_FLOOR : Number(input.extraIncomeFloor) || 0;
  const detected = detectExtraIncomeMonths(months, medianIncome, medianNetSavings, ratio, floor);
  const extraKeys: Record<string, boolean> = {};
  for (let i = 0; i < detected.extras.length; i++) extraKeys[detected.extras[i].key] = true;
  const typicalSavings = months.filter(m => !extraKeys[m.key]).map(m => m.netSavings);
  const deviationTypical = stdDev(typicalSavings.length >= 2 ? typicalSavings : savings);
  const extraSavedObserved = detected.extras.reduce((sum, e) => sum + e.savedExcess, 0);
  const extraSavedPerYear = months.length ? (extraSavedObserved * 12) / months.length : 0;
  const typicalYearEstimate = medianNetSavings * 12;

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
    medianIncome,
    stdDevTypical: deviationTypical,
    extraIncomeMonths: detected.extras,
    extraSavedObserved,
    extraSavedPerYear,
    incomeLevelChanged: detected.incomeLevelChanged,
    typicalYearEstimate,
    oneYearEstimate: typicalYearEstimate + extraSavedPerYear,
    points: [],
  };

  if (base.insufficientData) return base;

  const scenarios = [
    { name: 'low' as const, monthly: medianNetSavings - k * deviationTypical },
    { name: 'base' as const, monthly: medianNetSavings },
    { name: 'high' as const, monthly: medianNetSavings + k * deviationTypical },
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
      // Las pagas extra, al cierre y sin capitalizar los meses en que aun no
      // habian llegado: la lectura conservadora. Suman igual en los tres
      // escenarios, que es un desplazamiento limpio de la banda porque la banda
      // ya no incluye esos meses.
      capital += extraSavedPerYear;
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

// ---------------------------------------------------------------------------
// El texto que acompana a la proyeccion.
//
// Vive aqui y no en el componente por lo mismo que describe() en monthReport:
// una frase que afirma de donde sale un numero es codigo que se puede probar. Y
// el formato se hace a mano, sin toLocaleString, para que no dependa del idioma
// del dispositivo ni del ICU que tenga instalado quien ejecute los tests.
// ---------------------------------------------------------------------------

const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function shortMonth(key: string): string {
  const month = Number(String(key).slice(5, 7));
  if (!month || month < 1 || month > 12) return String(key);
  return SHORT_MONTHS[month - 1] + ' ' + String(key).slice(0, 4);
}

function euros(value: number): string {
  const rounded = Math.round(Number(value) || 0);
  const digits = String(Math.abs(rounded));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += '.';
    out += digits.charAt(i);
  }
  return (rounded < 0 ? '-' : '') + out + ' €';
}

/**
 * Las frases que explican la estimacion: de donde sale cada cifra y, sobre todo,
 * que NO entra. Sin la ultima linea, cualquiera puede leer la proyeccion como si
 * incluyera los traspasos entre cuentas.
 */
export function explainRealistic(result: RealisticResult): string[] {
  if (!result || result.insufficientData) {
    return ['Aún no hay historial suficiente para estimar tu ritmo real. Con tres meses de movimientos registrados aparecerá aquí.'];
  }

  const lines: string[] = [];
  lines.push(
    `Basado en tus ${result.monthsUsed} meses con movimiento: en un mes normal te quedan ${euros(result.medianNetSavings)}. ` +
    'Es la mediana y no la media, para que un mes raro no la mueva.',
  );

  const extras = result.extraIncomeMonths || [];
  if (result.incomeLevelChanged) {
    lines.push('Tus ingresos han subido de nivel durante estos meses, así que no he separado ninguna paga extra: lo que ves es tu ritmo reciente.');
  } else if (result.monthsUsed < EXTRA_MIN_MONTHS) {
    lines.push(`Con menos de ${EXTRA_MIN_MONTHS} meses todavía no busco pagas extra. En cuanto haya más historial se sumarán aparte.`);
  } else if (extras.length) {
    const cuantos = extras.length === 1 ? 'un mes' : `${extras.length} meses`;
    lines.push(
      `Además hubo ${cuantos} con ingresos muy por encima de lo habitual (${extras.map(e => shortMonth(e.key)).join(', ')}) ` +
      `y de ese extra se quedaron ${euros(result.extraSavedObserved)}, unos ${euros(result.extraSavedPerYear)} al año.`,
    );
  } else {
    lines.push('No he encontrado pagas extra ni ingresos atípicos en este historial: todos tus meses se parecen.');
  }

  if (extras.length && !result.incomeLevelChanged) {
    lines.push(
      `Total estimado: ${euros(result.oneYearEstimate)} al año = ${euros(result.typicalYearEstimate)} de doce meses normales ` +
      `+ ${euros(result.extraSavedPerYear)} de ingresos extra. La banda marca tus meses buenos y malos.`,
    );
  } else {
    lines.push(`Total estimado: ${euros(result.oneYearEstimate)} al año. La banda marca tus meses buenos y malos.`);
  }

  lines.push(
    'No entran aquí los traspasos entre cuentas, que cambian el dinero de sitio sin crearlo, ni las retiradas de huchas. ' +
    'Lo que mueves a una hucha sí cuenta como ahorro tuyo, no como gasto.',
  );

  return lines;
}
