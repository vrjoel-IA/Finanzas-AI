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

// ---------------------------------------------------------------------------
// Aportaciones a la cuenta conjunta: cada una es entera de quien la hace
// ---------------------------------------------------------------------------

const { buildTransferWeights, ownedAccountBalance } = ownership;

const couple = () => [
  account({ id: 'mia' }),
  account({ id: 'conjunta', ownershipPercent: 50, initialBalance: 0 }),
];

// Mi aportacion: las dos patas que crea el boton Transferir.
const myContribution = (amount, date = '2026-09-01', id = 'm') => [
  tx({ id: id + '-out', date, amount, category: 'Traspaso', type: 'expense', accountId: 'mia' }),
  tx({ id: id + '-in', date, amount, category: 'Traspaso', type: 'income', accountId: 'conjunta' }),
];
// La de la otra persona: entra en la conjunta sin salir de ninguna cuenta mia.
const partnerContribution = (amount, date = '2026-09-01', id = 'p') =>
  tx({ id, date, amount, category: 'Traspaso', type: 'income', accountId: 'conjunta' });

test('mi aportacion cuenta entera y la de la otra persona no cuenta', () => {
  const transactions = [...myContribution(27), partnerContribution(25)];
  const weights = buildTransferWeights(transactions, couple());
  assert.equal(weights['m-in'], 1);
  assert.equal(weights['p'], 0);
  assert.equal(weights['m-out'], undefined, 'la pata de mi cuenta no se toca');
  assert.equal(ownedAccountBalance(couple()[1], transactions, '2026-09-30', weights), 27);
});

test('los gastos de la conjunta restan enteros del saldo y a medias de mi parte', () => {
  const transactions = [
    ...myContribution(27),
    partnerContribution(25),
    tx({ id: 'g', amount: 40, category: 'Alimentacion', type: 'expense', accountId: 'conjunta' }),
  ];
  const accounts = couple();
  const weights = buildTransferWeights(transactions, accounts);
  assert.equal(ownedAccountBalance(accounts[1], transactions, '2026-09-30', weights), 27 - 20);

  const full = buildPeriodIndex(transactions);
  const owned = buildPeriodIndex(transactions, buildIndexWeights(accounts, [], transactions));
  assert.equal(accountDeltaAt(full, 'conjunta', '2026-09'), 12, 'el libro sigue integro');
  assert.equal(accountDeltaAt(owned, 'conjunta', '2026-09'), 7);
  assert.equal(aggregatePeriod(owned, '2026-09').baseExpense, 20, 'mi gasto es la mitad');
  assert.equal(aggregatePeriod(owned, '2026-09').baseIncome, 0, 'las aportaciones no son ingreso');
  // Al aportar, mi dinero solo cambia de sitio: lo que sale de mi cuenta entra entero en mi parte.
  assert.equal(accountDeltaAt(owned, 'mia', '2026-09') + 27, 0);
});

test('las dos patas registradas por separado se emparejan con unos dias de margen', () => {
  const transactions = [
    tx({ id: 'out', date: '2026-09-01', amount: 25, category: 'Traspaso', type: 'expense', accountId: 'mia' }),
    tx({ id: 'in', date: '2026-09-03', amount: 25, category: 'Traspaso', type: 'income', accountId: 'conjunta' }),
    tx({ id: 'lejos', date: '2026-09-20', amount: 25, category: 'Traspaso', type: 'income', accountId: 'conjunta' }),
  ];
  const weights = buildTransferWeights(transactions, couple());
  assert.equal(weights['in'], 1);
  assert.equal(weights['lejos'], 0, 'una salida mia solo empareja una entrada');
});

test('sacar dinero de la conjunta a una cuenta mia es mio entero', () => {
  const transactions = [
    tx({ id: 'out', amount: 30, category: 'Traspaso', type: 'expense', accountId: 'conjunta' }),
    tx({ id: 'in', amount: 30, category: 'Traspaso', type: 'income', accountId: 'mia' }),
  ];
  assert.equal(buildTransferWeights(transactions, couple())['out'], 1);
});

test('sin cuentas compartidas no hay pesos por movimiento y nada se muta', () => {
  const transactions = [...myContribution(27)];
  const before = JSON.stringify(transactions);
  assert.equal(Object.keys(buildTransferWeights(transactions, [account({ id: 'mia' }), account({ id: 'conjunta' })])).length, 0);
  buildTransferWeights(transactions, couple());
  assert.equal(JSON.stringify(transactions), before);
});

test('la aportacion apuntada junto a mi traspaso cuenta como de la otra persona', () => {
  // Mismo dia e importe que la mia: no debe robarle la pareja a mi salida.
  const transactions = [
    partnerContribution(27, '2026-09-01', 'p'),
    ...myContribution(27),
  ];
  const weights = buildTransferWeights(transactions, couple());
  assert.equal(weights['p'] + weights['m-in'], 1, 'una es mia y la otra suya');
  assert.equal(ownedAccountBalance(couple()[1], transactions, '2026-09-30', weights), 27);
});

test('el desglose de tu parte separa lo tuyo, lo suyo y los gastos', () => {
  const { ownedAccountBreakdown } = ownership;
  const transactions = [
    ...myContribution(27),
    partnerContribution(25),
    tx({ id: 'g', amount: 40, category: 'Alimentacion', type: 'expense', accountId: 'conjunta' }),
  ];
  const accounts = couple();
  const owned = ownedAccountBreakdown(accounts[1], transactions, '2026-09-30', buildTransferWeights(transactions, accounts));
  assert.equal(owned.mine, 27);
  assert.equal(owned.partner, 25);
  assert.equal(owned.shared, -20);
  assert.equal(owned.total, 7);
});
