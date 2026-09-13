import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServices } from './_load.mjs';

const { realisticProjection, periodIndex } = loadServices();
const { projectRealistic, buildMonthPoints, median, percentile, stdDev } = realisticProjection;
const { buildPeriodIndex } = periodIndex;

const months = (netSavingsPerMonth, count = 12, expense = 1000) =>
  Array.from({ length: count }, (_, i) => {
    const net = Array.isArray(netSavingsPerMonth) ? netSavingsPerMonth[i] : netSavingsPerMonth;
    return { key: '2026-' + String(i + 1).padStart(2, '0'), income: expense + net, expense, netSavings: net };
  });

const baseInput = (over = {}) => ({
  months: months(400),
  seedLiquid: 1000,
  seedSavings: 4000,
  annualGrowthRate: 0,
  years: 10,
  inflationRate: 0,
  volatilityK: 1,
  ...over,
});

test('estadistica basica', () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
  assert.equal(percentile([10, 20, 30, 40], 0.5), 25);
  assert.equal(percentile([10], 0.9), 10);
  assert.equal(stdDev([5, 5, 5]), 0);
  assert.ok(stdDev([0, 10]) > 0);
});

test('con menos de tres meses no se inventa ninguna proyeccion', () => {
  const result = projectRealistic(baseInput({ months: months(400, 2) }));
  assert.equal(result.insufficientData, true);
  assert.equal(result.points.length, 0);
});

test('entre tres y cinco meses se estima, pero avisando de que es poco fiable', () => {
  const result = projectRealistic(baseInput({ months: months(400, 4) }));
  assert.equal(result.insufficientData, false);
  assert.equal(result.lowConfidence, true);
  assert.ok(result.points.length > 0);
});

test('con doce meses la estimacion se da por buena', () => {
  const result = projectRealistic(baseInput());
  assert.equal(result.lowConfidence, false);
  assert.equal(result.monthsUsed, 12);
});

test('el punto de hoy es exactamente el patrimonio actual', () => {
  // Regresion del desfase del grafico de Proyecciones, donde "Hoy" ya incluia
  // un mes de intereses y de aportacion.
  const result = projectRealistic(baseInput({ seedLiquid: 1200, seedSavings: 4300 }));
  assert.equal(result.points[0].label, 'Hoy');
  assert.equal(result.points[0].base, 5500);
  assert.equal(result.points[0].low, 5500);
  assert.equal(result.points[0].high, 5500);
});

test('la banda nunca se cruza: pesimista por debajo y optimista por encima', () => {
  const result = projectRealistic(baseInput({ months: months([100, 900, 200, 800, 50, 950, 300, 700, 150, 850, 250, 750]) }));
  for (const point of result.points) {
    assert.ok(point.low <= point.base, 'banda inferior por encima de la base en el anio ' + point.year);
    assert.ok(point.base <= point.high, 'base por encima de la banda superior en el anio ' + point.year);
  }
});

test('sin variabilidad la banda se cierra sobre la linea base', () => {
  const result = projectRealistic(baseInput());
  const year5 = result.points[5];
  assert.equal(year5.low, year5.base);
  assert.equal(year5.high, year5.base);
});

test('un mes atipico mueve la media pero casi no mueve la mediana', () => {
  const normales = months(400);
  const conPagaExtra = months(400);
  conPagaExtra[6] = { ...conPagaExtra[6], netSavings: 6000 };

  const base = projectRealistic(baseInput({ months: normales }));
  const extra = projectRealistic(baseInput({ months: conPagaExtra }));

  assert.equal(extra.medianNetSavings, base.medianNetSavings, 'la mediana aguanta el mes raro');
  assert.ok(extra.meanNetSavings > base.meanNetSavings + 400, 'la media si se dispara');
});

test('la estimacion a un anio es el ahorro tipico por doce', () => {
  const result = projectRealistic(baseInput({ months: months(400) }));
  assert.equal(result.oneYearEstimate, 4800);
});

test('la inflacion erosiona el ahorro anio tras anio', () => {
  const sinInflacion = projectRealistic(baseInput({ inflationRate: 0 }));
  const conInflacion = projectRealistic(baseInput({ inflationRate: 2.5 }));
  assert.ok(conInflacion.points[10].base < sinInflacion.points[10].base);
  assert.equal(conInflacion.points[0].base, sinInflacion.points[0].base, 'hoy no cambia');
});

test('la rentabilidad compone sobre el capital ahorrado', () => {
  const sinRentabilidad = projectRealistic(baseInput({ annualGrowthRate: 0 }));
  const conRentabilidad = projectRealistic(baseInput({ annualGrowthRate: 6 }));
  assert.ok(conRentabilidad.points[10].base > sinRentabilidad.points[10].base);
});

test('el colchon de imprevistos viene desactivado para no contarlos dos veces', () => {
  const pordefecto = projectRealistic(baseInput());
  const tensado = projectRealistic(baseInput({ contingencyPerYear: 1200 }));
  assert.ok(tensado.points[10].base < pordefecto.points[10].base);
  assert.ok(pordefecto.irregularExpenseBuffer >= 0);
});

test('misma entrada, misma salida', () => {
  const input = baseInput();
  assert.equal(
    JSON.stringify(projectRealistic(input).points),
    JSON.stringify(projectRealistic(input).points),
  );
});

test('los meses sin movimiento no entran en la estimacion', () => {
  const index = buildPeriodIndex([
    { id: 't1', date: '2026-07-05', amount: 2000, type: 'income', category: 'Nomina', accountId: 'a1', description: '', isRefund: false },
    { id: 't2', date: '2026-07-15', amount: 1500, type: 'expense', category: 'Vivienda', accountId: 'a1', description: '', isRefund: false },
    { id: 't3', date: '2026-09-05', amount: 2000, type: 'income', category: 'Nomina', accountId: 'a1', description: '', isRefund: false },
  ]);
  const points = buildMonthPoints(index, '2026-09', 3);
  assert.equal(points.length, 2, 'agosto no tuvo movimiento y no cuenta');
  assert.equal(JSON.stringify(points.map(p => p.key)), JSON.stringify(['2026-07', '2026-09']));
  assert.equal(points[0].netSavings, 500);
});
