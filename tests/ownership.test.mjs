import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServices } from './_load.mjs';

const { ownership, periodIndex } = loadServices();
const { ownershipWeight, ownedAmount, isShared, buildIndexWeights, hasSharedEntities } = ownership;
const { buildPeriodIndex, aggregatePeriod, accountDeltaAt, savingDeltaAt } = periodIndex;

const tx = (over = {}) => ({
  id: 't' + Math.random(), date: '2026-09-10', amount: 100, description: 'x',
  category: 'Ocio', type: 'expense', accountId: 'a1', isRefund: false, ...over,
});

const account = (over = {}) => ({
  id: 'a1', name: 'Cuenta', type: 'Bank', initialBalance: 0, currentBalance: 0, color: '#000', ...over,
});

// ---------------------------------------------------------------------------
// Retrocompatibilidad: sin el campo, todo se comporta como antes
// ---------------------------------------------------------------------------

test('una cuenta sin porcentaje declarado es 100% tuya', () => {
  assert.equal(ownershipWeight(undefined), 1);
  assert.equal(ownershipWeight(null), 1);
  assert.equal(ownershipWeight(NaN), 1);
  assert.equal(ownershipWeight(''), 1);
  assert.equal(isShared(account()), false);
  assert.equal(isShared(undefined), false);
});

test('el porcentaje se limita al rango util', () => {
  assert.equal(ownershipWeight(50), 0.5);
  assert.equal(ownershipWeight(100), 1);
  assert.equal(ownershipWeight(0), 0);
  assert.equal(ownershipWeight(-20), 0, 'nada por debajo de cero');
  assert.equal(ownershipWeight(500), 1, 'nada por encima del total');
  assert.equal(ownedAmount(80, 50), 40);
});

test('solo se considera compartido lo que declara menos del 100%', () => {
  assert.equal(isShared(account({ ownershipPercent: 50 })), true);
  assert.equal(isShared(account({ ownershipPercent: 100 })), false);
  assert.equal(hasSharedEntities([account()], []), false);
  assert.equal(hasSharedEntities([account(), account({ id: 'a2', ownershipPercent: 50 })], []), true);
});

// ---------------------------------------------------------------------------
// El libro contable no se pondera nunca
// ---------------------------------------------------------------------------

test('con todo al 100%, el indice ponderado es identico al integro', () => {
  const transactions = [
    tx({ amount: 100, type: 'expense', category: 'Ocio' }),
    tx({ amount: 2000, type: 'income', category: 'Nomina' }),
    tx({ amount: 300, type: 'expense', category: 'Ahorro', savingId: 's1' }),
  ];
  const accounts = [account({ id: 'a1', ownershipPercent: 100 }), account({ id: 'a2' })];
  const savings = [{ id: 's1', name: 'Fondo', currentAmount: 0, isInvestment: false, color: '#000' }];

  const full = buildPeriodIndex(transactions);
  const weighted = buildPeriodIndex(transactions, buildIndexWeights(accounts, savings));

  assert.equal(
    JSON.stringify(aggregatePeriod(weighted, '2026-09')),
    JSON.stringify(aggregatePeriod(full, '2026-09')),
  );
});

test('una cuenta al 50% reduce a la mitad su analisis pero no el saldo integro', () => {
  const transactions = [
    tx({ id: 'conjunta', amount: 80, type: 'expense', category: 'Alimentacion', accountId: 'conjunta' }),
    tx({ id: 'propia', amount: 40, type: 'expense', category: 'Alimentacion', accountId: 'propia' }),
  ];
  const accounts = [
    account({ id: 'conjunta', ownershipPercent: 50 }),
    account({ id: 'propia' }),
  ];

  const full = buildPeriodIndex(transactions);
  const mine = buildPeriodIndex(transactions, buildIndexWeights(accounts, []));

  // Libro: el gasto de la cuenta conjunta se registra integro, como en el banco.
  assert.equal(aggregatePeriod(full, '2026-09').baseExpense, 120);
  assert.equal(accountDeltaAt(full, 'conjunta', '2026-09'), -80);

  // Analisis: de esos 80 solo son tuyos 40.
  assert.equal(aggregatePeriod(mine, '2026-09').baseExpense, 80);
  assert.equal(accountDeltaAt(mine, 'conjunta', '2026-09'), -40);
  assert.equal(accountDeltaAt(mine, 'propia', '2026-09'), -40, 'la cuenta propia no se toca');
});

test('la aportacion de la pareja mueve saldo sin contar como ingreso tuyo', () => {
  // La rutina recomendada: ambas aportaciones como traspaso.
  const transactions = [
    tx({ amount: 500, type: 'expense', category: 'Traspaso', accountId: 'propia' }),
    tx({ amount: 500, type: 'income', category: 'Traspaso', accountId: 'conjunta' }),
    tx({ amount: 500, type: 'income', category: 'Traspaso', accountId: 'conjunta' }),
    tx({ amount: 200, type: 'expense', category: 'Alimentacion', accountId: 'conjunta' }),
  ];
  const accounts = [account({ id: 'conjunta', ownershipPercent: 50 }), account({ id: 'propia' })];
  const mine = buildPeriodIndex(transactions, buildIndexWeights(accounts, []));
  const month = aggregatePeriod(mine, '2026-09');

  assert.equal(month.baseIncome, 0, 'una aportacion no es ingreso');
  assert.equal(month.baseExpense, 100, 'del gasto conjunto de 200 solo son tuyos 100');

  // Sales 500 de tu cuenta y entras en tu mitad de la conjunta: 500 de los 1000.
  assert.equal(accountDeltaAt(mine, 'propia', '2026-09'), -500);
  assert.equal(accountDeltaAt(mine, 'conjunta', '2026-09'), 400, '(1000 - 200) / 2');
});

test('la hucha usa su propio porcentaje, no el de la cuenta', () => {
  const transactions = [
    tx({ amount: 300, type: 'expense', category: 'Ahorro', savingId: 's1', accountId: 'conjunta' }),
  ];
  const accounts = [account({ id: 'conjunta', ownershipPercent: 50 })];
  const savings = [{ id: 's1', name: 'Viaje', currentAmount: 0, isInvestment: false, color: '#000', ownershipPercent: 50 }];
  const mine = buildPeriodIndex(transactions, buildIndexWeights(accounts, savings));

  assert.equal(accountDeltaAt(mine, 'conjunta', '2026-09'), -150);
  assert.equal(savingDeltaAt(mine, 's1', '2026-09'), 150, 'sin esto se crearia patrimonio de la nada');
});

test('ponderar no altera las transacciones de entrada', () => {
  const transactions = [tx({ amount: 80, accountId: 'conjunta' })];
  const before = JSON.stringify(transactions);
  buildPeriodIndex(transactions, buildIndexWeights([account({ id: 'conjunta', ownershipPercent: 50 })], []));
  assert.equal(JSON.stringify(transactions), before);
});
