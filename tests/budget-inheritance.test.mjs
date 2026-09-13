import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServices } from './_load.mjs';

const { periodIndex, budgetPlan } = loadServices();
const { buildPeriodIndex } = periodIndex;
const {
  resolveEffectiveBudgets, materializeBudgets, findInheritanceSource,
  isNormalMonth, hasOwnBudgets, listOrphanBudgets, budgetKey,
} = budgetPlan;

const budget = (over = {}) => ({
  id: 'b' + Math.random(), category: 'Ocio', limit: 100, icon: 'Coffee',
  spent: 0, type: 'expense', color: '#000', ...over,
});

const tx = (over = {}) => ({
  id: 't' + Math.random(), date: '2026-09-10', amount: 100, description: 'x',
  category: 'Ocio', type: 'expense', accountId: 'a1', isRefund: false, ...over,
});

/** Un mes con ingresos y gastos dentro de lo normal (gasto tipico ~1000). */
const normalMonth = (month, expense = 1000) => [
  tx({ date: month + '-05', amount: 2000, type: 'income', category: 'Nomina' }),
  tx({ date: month + '-15', amount: expense, type: 'expense', category: 'Vivienda' }),
];

const sortedKeys = list => list.map(budgetKey).slice().sort().join(', ');
const byCategory = (list, category) => list.filter(b => b.category === category)[0];

// ---------------------------------------------------------------------------
// La garantia que importa: resolver nunca escribe.
// ---------------------------------------------------------------------------

test('resolver presupuestos no muta la entrada ni inventa presupuestos', () => {
  const budgets = [
    budget({ id: 'sep1', category: 'Alimentacion', period: '2026-09' }),
    budget({ id: 'sep2', category: 'Ocio', period: '2026-09' }),
  ];
  const before = JSON.stringify(budgets);
  const index = buildPeriodIndex(normalMonth('2026-09'));

  const resolved = resolveEffectiveBudgets(budgets, '2026-10', index);

  assert.equal(JSON.stringify(budgets), before, 'la lista de presupuestos ha cambiado');
  const knownIds = budgets.map(b => b.id);
  for (const item of resolved) {
    assert.ok(knownIds.indexOf(item.sourceId) !== -1, 'ha aparecido un presupuesto que no existia: ' + item.sourceId);
  }
});

// ---------------------------------------------------------------------------
// Prioridad de la fuente
// ---------------------------------------------------------------------------

test('octubre hereda de octubre del anio anterior antes que de septiembre', () => {
  const budgets = [
    budget({ id: 'oct25', category: 'Regalos', limit: 300, period: '2025-10' }),
    budget({ id: 'sep26', category: 'Ocio', limit: 100, period: '2026-09' }),
  ];
  const index = buildPeriodIndex([
    ...normalMonth('2025-10'),
    ...normalMonth('2026-09'),
  ]);

  const source = findInheritanceSource(budgets, index, '2026-10');
  assert.equal(source.period, '2025-10');
  assert.equal(source.reason, 'previous-year');

  const resolved = resolveEffectiveBudgets(budgets, '2026-10', index);
  assert.equal(sortedKeys(resolved), 'Regalos|expense');
  assert.equal(resolved[0].inheritedFrom, '2025-10');
});

test('si el mes del anio anterior fue atipico, se hereda del mes anterior', () => {
  const budgets = [
    budget({ id: 'oct25', category: 'Regalos', period: '2025-10' }),
    budget({ id: 'sep26', category: 'Ocio', period: '2026-09' }),
  ];
  // Octubre de 2025 fue la mudanza: gasta cinco veces lo normal.
  const index = buildPeriodIndex([
    ...normalMonth('2025-08'),
    ...normalMonth('2025-09'),
    ...normalMonth('2025-10', 5000),
    ...normalMonth('2025-11'),
    ...normalMonth('2026-09'),
  ]);

  assert.equal(isNormalMonth(budgets, index, '2025-10'), false, 'la mudanza no es un mes normal');
  const source = findInheritanceSource(budgets, index, '2026-10');
  assert.equal(source.period, '2026-09');
  assert.equal(source.reason, 'previous-month');
});

test('un mes sin ingresos o sin gastos no sirve de referencia', () => {
  const budgets = [budget({ id: 'oct25', period: '2025-10' })];
  const soloGastos = buildPeriodIndex([tx({ date: '2025-10-15', amount: 900, type: 'expense' })]);
  assert.equal(isNormalMonth(budgets, soloGastos, '2025-10'), false);

  const soloIngresos = buildPeriodIndex([tx({ date: '2025-10-05', amount: 2000, type: 'income' })]);
  assert.equal(isNormalMonth(budgets, soloIngresos, '2025-10'), false);
});

test('un mes sin presupuesto propio nunca es fuente de herencia', () => {
  const index = buildPeriodIndex(normalMonth('2025-10'));
  assert.equal(isNormalMonth([], index, '2025-10'), false);
  assert.equal(hasOwnBudgets([], '2025-10'), false);
});

test('sin ningun mes anterior con presupuesto, no hay herencia', () => {
  const index = buildPeriodIndex(normalMonth('2026-09'));
  assert.equal(findInheritanceSource([], index, '2026-10'), null);
  assert.equal(resolveEffectiveBudgets([], '2026-10', index).length, 0);
});

test('no se hereda de un mes posterior', () => {
  const budgets = [budget({ id: 'nov', period: '2026-11' })];
  const index = buildPeriodIndex(normalMonth('2026-11'));
  assert.equal(findInheritanceSource(budgets, index, '2026-10'), null);
});

// ---------------------------------------------------------------------------
// Herencia por categoria: el bug que hacia desaparecer presupuestos
// ---------------------------------------------------------------------------

test('un solo presupuesto propio ya no bloquea la herencia del resto', () => {
  // Regresion de Budget.tsx:63, donde un unico presupuesto en el mes cortaba
  // la copia de todas las demas categorias.
  const budgets = [
    budget({ id: 'sep1', category: 'Alimentacion', limit: 200, period: '2026-09' }),
    budget({ id: 'sep2', category: 'Ocio', limit: 100, period: '2026-09' }),
    budget({ id: 'sep3', category: 'Transporte', limit: 80, period: '2026-09' }),
    budget({ id: 'oct1', category: 'Transporte', limit: 120, period: '2026-10' }),
  ];
  const index = buildPeriodIndex(normalMonth('2026-09'));
  const resolved = resolveEffectiveBudgets(budgets, '2026-10', index);

  assert.equal(sortedKeys(resolved), 'Alimentacion|expense, Ocio|expense, Transporte|expense');
  assert.equal(byCategory(resolved, 'Transporte').origin, 'own');
  assert.equal(byCategory(resolved, 'Transporte').limit, 120, 'el propio del mes manda');
  assert.equal(byCategory(resolved, 'Alimentacion').origin, 'inherited');
  assert.equal(byCategory(resolved, 'Alimentacion').limit, 200, 'se hereda el importe tal cual');
});

test('solo lo propio del mes es editable', () => {
  const budgets = [
    budget({ id: 'sep1', category: 'Ocio', period: '2026-09' }),
    budget({ id: 'oct1', category: 'Transporte', period: '2026-10' }),
  ];
  const index = buildPeriodIndex(normalMonth('2026-09'));
  const resolved = resolveEffectiveBudgets(budgets, '2026-10', index);
  assert.equal(byCategory(resolved, 'Transporte').editable, true);
  assert.equal(byCategory(resolved, 'Ocio').editable, false);
});

test('precedencia propio > heredado > sin periodo', () => {
  const budgets = [
    budget({ id: 'legacy', category: 'Ocio', limit: 999 }),
    budget({ id: 'sep', category: 'Ocio', limit: 100, period: '2026-09' }),
    budget({ id: 'oct', category: 'Ocio', limit: 50, period: '2026-10' }),
  ];
  const index = buildPeriodIndex(normalMonth('2026-09'));
  const resolved = resolveEffectiveBudgets(budgets, '2026-10', index);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].limit, 50);
  assert.equal(resolved[0].origin, 'own');
});

test('los presupuestos sin periodo siguen aplicando donde no hay nada que los tape', () => {
  // Retrocompatibilidad: los tres presupuestos semilla no tienen period.
  const budgets = [budget({ id: 'legacy', category: 'Alimentacion', limit: 200 })];
  const index = buildPeriodIndex(normalMonth('2026-09'));
  const resolved = resolveEffectiveBudgets(budgets, '2026-10', index);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].origin, 'legacy');
  assert.equal(resolved[0].limit, 200);
});

test('un ingreso y un gasto de la misma categoria ya no se pisan', () => {
  const budgets = [
    budget({ id: 'g', category: 'Ventas', type: 'expense', limit: 50, period: '2026-09' }),
    budget({ id: 'i', category: 'Ventas', type: 'income', limit: 900, period: '2026-09' }),
  ];
  const index = buildPeriodIndex(normalMonth('2026-09'));
  const resolved = resolveEffectiveBudgets(budgets, '2026-09', index);
  assert.equal(resolved.length, 2);
});

test('un presupuesto sin tipo se trata como gasto en vez de desaparecer', () => {
  const budgets = [{ id: 'x', category: 'Ocio', limit: 100, icon: 'Coffee', spent: 0, color: '#000', period: '2026-09' }];
  const index = buildPeriodIndex(normalMonth('2026-09'));
  const resolved = resolveEffectiveBudgets(budgets, '2026-09', index);
  assert.equal(resolved[0].type, 'expense');
});

// ---------------------------------------------------------------------------
// Vista anual
// ---------------------------------------------------------------------------

test('la vista anual suma los limites de los doce meses y no deja editar', () => {
  const budgets = [budget({ id: 'ene', category: 'Ocio', limit: 100, period: '2026-01' })];
  const index = buildPeriodIndex(normalMonth('2026-01'));
  const resolved = resolveEffectiveBudgets(budgets, '2026', index);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].origin, 'annualized');
  assert.equal(resolved[0].editable, false);
  // Enero es propio y los once meses siguientes lo heredan: 12 x 100.
  assert.equal(resolved[0].limit, 1200);
});

test('los presupuestos huerfanos con periodo de anio se pueden localizar', () => {
  const budgets = [
    budget({ id: 'malo', category: 'Ocio', period: '2026' }),
    budget({ id: 'bueno', category: 'Ocio', period: '2026-09' }),
    budget({ id: 'legacy', category: 'Ocio' }),
  ];
  const orphans = listOrphanBudgets(budgets);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].id, 'malo');
});

// ---------------------------------------------------------------------------
// Materializar: la unica escritura
// ---------------------------------------------------------------------------

test('materializar crea copias nuevas y no toca el presupuesto de origen', () => {
  const budgets = [
    budget({ id: 'sep1', category: 'Alimentacion', limit: 200, period: '2026-09' }),
    budget({ id: 'sep2', category: 'Ocio', limit: 100, period: '2026-09' }),
  ];
  const before = JSON.stringify(budgets);
  const index = buildPeriodIndex(normalMonth('2026-09'));

  let counter = 0;
  const result = materializeBudgets(budgets, '2026-10', 'all', () => 'nuevo' + (++counter), index);

  assert.equal(JSON.stringify(budgets), before, 'la lista original ha cambiado');
  assert.equal(result.length, 4, 'se anaden dos, no se sustituye nada');
  const septiembre = result.filter(b => b.period === '2026-09');
  assert.equal(JSON.stringify(septiembre), JSON.stringify(budgets), 'septiembre debe quedar intacto');
  const octubre = result.filter(b => b.period === '2026-10');
  assert.equal(octubre.length, 2);
  assert.equal(octubre[0].id, 'nuevo1', 'ids nuevos, nunca reutilizados');
  assert.equal(octubre[0].spent, 0);
});

test('materializar una sola categoria deja el resto heredado', () => {
  const budgets = [
    budget({ id: 'sep1', category: 'Alimentacion', period: '2026-09' }),
    budget({ id: 'sep2', category: 'Ocio', period: '2026-09' }),
  ];
  const index = buildPeriodIndex(normalMonth('2026-09'));
  const result = materializeBudgets(budgets, '2026-10', ['Ocio'], () => 'nuevo', index);
  assert.equal(result.length, 3);
  assert.equal(result.filter(b => b.period === '2026-10').length, 1);
  assert.equal(result.filter(b => b.period === '2026-10')[0].category, 'Ocio');
});

test('materializar dos veces no duplica nada', () => {
  const budgets = [budget({ id: 'sep1', category: 'Ocio', period: '2026-09' })];
  const index = buildPeriodIndex(normalMonth('2026-09'));
  const once = materializeBudgets(budgets, '2026-10', 'all', () => 'n1', index);
  const twice = materializeBudgets(once, '2026-10', 'all', () => 'n2', index);
  assert.equal(twice.length, once.length, 'la segunda pasada no debe anadir nada');
});

test('materializar sobre un periodo que no es un mes no cambia nada', () => {
  const budgets = [budget({ id: 'sep1', period: '2026-09' })];
  const index = buildPeriodIndex(normalMonth('2026-09'));
  assert.equal(materializeBudgets(budgets, '2026', 'all', () => 'n', index), budgets);
});
