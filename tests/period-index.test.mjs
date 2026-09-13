import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServices } from './_load.mjs';

const { periodIndex } = loadServices();
const {
  buildPeriodIndex, aggregatePeriod, monthSeries,
  accountDeltaAt, savingDeltaAt, categorySpent, topExpenseCategories,
  topCategories, periodHeadline, savingFlow,
} = periodIndex;

const tx = (over = {}) => ({
  id: 't' + Math.random(), date: '2026-09-10', amount: 100, description: 'x',
  category: 'Ocio', type: 'expense', accountId: 'a1', isRefund: false, ...over,
});

// ---------------------------------------------------------------------------
// La garantia que importa: leer nunca escribe.
// ---------------------------------------------------------------------------

test('construir el indice no toca ni una transaccion', () => {
  const transactions = [
    tx({ id: 't1', amount: 100, type: 'expense', category: 'Ocio' }),
    tx({ id: 't2', amount: 2000, type: 'income', category: 'Nomina' }),
    tx({ id: 't3', amount: 300, type: 'expense', category: 'Ahorro', savingId: 's1' }),
    tx({ id: 't4', amount: 50, type: 'income', category: 'Ocio', refundId: 'r1' }),
  ];
  const before = JSON.stringify(transactions);
  buildPeriodIndex(transactions);
  assert.equal(JSON.stringify(transactions), before, 'el historial de entrada ha cambiado');
});

// ---------------------------------------------------------------------------
// Semantica de los totales
// ---------------------------------------------------------------------------

test('los traspasos mueven saldo pero no son ingreso ni gasto', () => {
  const index = buildPeriodIndex([
    tx({ amount: 500, type: 'expense', category: 'Traspaso', accountId: 'a1' }),
    tx({ amount: 500, type: 'income', category: 'Traspaso', accountId: 'a2' }),
  ]);
  const month = aggregatePeriod(index, '2026-09');
  assert.equal(month.baseIncome, 0);
  assert.equal(month.baseExpense, 0);
  assert.equal(month.netResult, 0);
  assert.equal(accountDeltaAt(index, 'a1', '2026-09'), -500);
  assert.equal(accountDeltaAt(index, 'a2', '2026-09'), 500);
  // Entre dos cuentas propias, el traspaso es neutro en el total.
  assert.equal(accountDeltaAt(index, 'a1', '2026-09') + accountDeltaAt(index, 'a2', '2026-09'), 0);
});

test('una aportacion a hucha baja la cuenta y sube la hucha', () => {
  const index = buildPeriodIndex([
    tx({ amount: 300, type: 'expense', category: 'Ahorro', savingId: 's1', accountId: 'a1' }),
  ]);
  const month = aggregatePeriod(index, '2026-09');
  assert.equal(month.savingDeposits, 300);
  assert.equal(month.baseExpense, 0, 'una aportacion a hucha no es gasto');
  assert.equal(accountDeltaAt(index, 'a1', '2026-09'), -300);
  assert.equal(savingDeltaAt(index, 's1', '2026-09'), 300);
});

test('una retirada de hucha sube la cuenta y baja la hucha', () => {
  const index = buildPeriodIndex([
    tx({ amount: 200, type: 'income', category: 'Ahorro', savingId: 's1', accountId: 'a1' }),
  ]);
  const month = aggregatePeriod(index, '2026-09');
  assert.equal(month.savingWithdrawals, 200);
  assert.equal(month.baseIncome, 0);
  assert.equal(savingDeltaAt(index, 's1', '2026-09'), -200);
});

test('un reembolso cobrado reduce el gasto neto y no cuenta como ingreso', () => {
  const index = buildPeriodIndex([
    tx({ amount: 100, type: 'expense', category: 'Ocio' }),
    tx({ amount: 40, type: 'income', category: 'Ocio', refundId: 'r1' }),
  ]);
  const month = aggregatePeriod(index, '2026-09');
  assert.equal(month.baseExpense, 100);
  assert.equal(month.refundRecoveries, 40);
  assert.equal(month.netExpense, 60);
  assert.equal(month.baseIncome, 0, 'un reembolso no es ingreso');
  assert.equal(categorySpent(month, 'Ocio', 'expense'), 60);
});

test('netExpense puede ser negativo: el recorte a cero lo decide quien consume', () => {
  const index = buildPeriodIndex([
    tx({ amount: 10, type: 'expense', category: 'Ocio' }),
    tx({ amount: 90, type: 'income', category: 'Ocio', refundId: 'r1' }),
  ]);
  assert.equal(aggregatePeriod(index, '2026-09').netExpense, -80);
});

// ---------------------------------------------------------------------------
// Agregacion por periodo
// ---------------------------------------------------------------------------

test('el agregado anual es la suma exacta de sus meses', () => {
  const index = buildPeriodIndex([
    tx({ date: '2026-01-05', amount: 100, type: 'expense', category: 'Ocio' }),
    tx({ date: '2026-06-15', amount: 250, type: 'expense', category: 'Ocio' }),
    tx({ date: '2026-11-20', amount: 1000, type: 'income', category: 'Nomina' }),
    tx({ date: '2025-11-20', amount: 999, type: 'income', category: 'Nomina' }),
  ]);
  const year = aggregatePeriod(index, '2026');
  const months = ['2026-01', '2026-06', '2026-11'].map(k => aggregatePeriod(index, k));
  assert.equal(year.baseExpense, months.reduce((s, m) => s + m.baseExpense, 0));
  assert.equal(year.baseIncome, months.reduce((s, m) => s + m.baseIncome, 0));
  assert.equal(year.baseExpense, 350);
  assert.equal(year.baseIncome, 1000, 'no debe colarse el anio anterior');
  assert.equal(year.byCategory.Ocio.expense, 350);
});

test('un periodo sin datos devuelve ceros, nunca undefined', () => {
  const index = buildPeriodIndex([tx({ date: '2026-09-10' })]);
  const empty = aggregatePeriod(index, '2030-03');
  assert.equal(empty.baseExpense, 0);
  assert.equal(empty.netResult, 0);
  assert.equal(empty.txCount, 0);
  assert.equal(Object.keys(empty.byCategory).length, 0);
  assert.equal(aggregatePeriod(index, 'basura').baseExpense, 0);
});

test('la serie mensual rellena los meses vacios en vez de saltarselos', () => {
  const index = buildPeriodIndex([
    tx({ date: '2026-07-01', amount: 100 }),
    tx({ date: '2026-09-01', amount: 200 }),
  ]);
  const series = monthSeries(index, '2026-09', 3);
  assert.equal(series.length, 3);
  // Comparacion por valor: los arrays creados dentro del sandbox no comparten
  // prototipo con los de aqui, y deepStrictEqual compara tambien el prototipo.
  assert.equal(JSON.stringify(series.map(m => m.key)), JSON.stringify(['2026-07', '2026-08', '2026-09']));
  assert.equal(JSON.stringify(series.map(m => m.baseExpense)), JSON.stringify([100, 0, 200]));
});

test('el saldo acumulado arrastra los meses sin movimiento', () => {
  const index = buildPeriodIndex([
    tx({ date: '2026-07-01', amount: 100, type: 'expense', accountId: 'a1' }),
    tx({ date: '2026-09-01', amount: 30, type: 'expense', accountId: 'a1' }),
  ]);
  assert.equal(accountDeltaAt(index, 'a1', '2026-06'), 0, 'antes de existir movimiento');
  assert.equal(accountDeltaAt(index, 'a1', '2026-07'), -100);
  assert.equal(accountDeltaAt(index, 'a1', '2026-08'), -100, 'mes sin movimiento conserva el saldo');
  assert.equal(accountDeltaAt(index, 'a1', '2026-09'), -130);
  assert.equal(accountDeltaAt(index, 'a1', '2026'), -130, 'clave de anio corta a 31 de diciembre');
  assert.equal(accountDeltaAt(index, 'desconocida', '2026-09'), 0);
});

// ---------------------------------------------------------------------------
// Datos sucios
// ---------------------------------------------------------------------------

test('las fechas inservibles se descartan sin romper ni contaminar ningun mes', () => {
  const index = buildPeriodIndex([
    tx({ date: '2026-09-10', amount: 100 }),
    tx({ date: '' }),
    tx({ date: null }),
    tx({ date: 'no-es-una-fecha' }),
    tx({ date: '2026-13-01' }),
    null,
  ]);
  assert.equal(index.skipped, 5);
  assert.equal(JSON.stringify(index.monthKeys), JSON.stringify(['2026-09']));
  assert.equal(aggregatePeriod(index, '2026-09').baseExpense, 100);
});

test('tolera fechas con hora y importes no numericos', () => {
  const index = buildPeriodIndex([
    tx({ date: '2026-09-10T14:30:00.000Z', amount: 100 }),
    tx({ date: '2026-09-11', amount: 'ochenta' }),
    tx({ date: '2026-09-12', amount: undefined }),
  ]);
  assert.equal(aggregatePeriod(index, '2026-09').baseExpense, 100);
  assert.equal(index.skipped, 0, 'un importe corrupto no descarta la transaccion, solo suma cero');
});

test('el top de categorias ordena por gasto neto y omite las que no gastan', () => {
  const index = buildPeriodIndex([
    tx({ amount: 300, category: 'Alimentacion' }),
    tx({ amount: 500, category: 'Vivienda' }),
    tx({ amount: 100, category: 'Ocio' }),
    tx({ amount: 100, type: 'income', category: 'Ocio', refundId: 'r1' }),
    tx({ amount: 2000, type: 'income', category: 'Nomina' }),
  ]);
  const top = topExpenseCategories(aggregatePeriod(index, '2026-09'), 5);
  assert.equal(JSON.stringify(top.map(r => r.category)), JSON.stringify(['Vivienda', 'Alimentacion']));
  assert.equal(JSON.stringify(top.map(r => r.amount)), JSON.stringify([500, 300]));
});

// ---------------------------------------------------------------------------
// Equivalencia con el calculo original
// ---------------------------------------------------------------------------

test('el saldo del indice coincide con el bucle original sobre 200 transacciones', () => {
  // Bucle tal cual esta hoy en App.tsx:463-478.
  const historicalBalance = (transactions, initialBalance, accountId, dateStr) => {
    let cutoff = dateStr;
    if (dateStr.length === 4) cutoff = `${dateStr}-12-31`;
    else if (dateStr.length === 7) {
      const [y, m] = dateStr.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      cutoff = `${dateStr}-${lastDay}`;
    }
    let balance = initialBalance;
    transactions.filter(t => t.accountId === accountId && t.date <= cutoff).forEach(t => {
      balance += (t.type === 'income' ? t.amount : -t.amount);
    });
    return balance;
  };

  // Fixture determinista: 200 movimientos, dos cuentas, meses vacios intercalados,
  // traspasos, huchas, reembolsos y alguna fecha con hora.
  const categories = ['Ocio', 'Alimentacion', 'Vivienda', 'Traspaso', 'Ahorro', 'Nomina'];
  const transactions = [];
  let seed = 7;
  const next = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 200; i++) {
    const year = 2024 + next(3);
    const month = 1 + next(12);
    const day = 1 + next(28);
    const category = categories[next(categories.length)];
    const type = next(2) === 0 ? 'income' : 'expense';
    const pad = n => (n < 10 ? '0' + n : '' + n);
    transactions.push(tx({
      id: 'fx' + i,
      date: `${year}-${pad(month)}-${pad(day)}` + (i % 17 === 0 ? 'T09:15:00' : ''),
      amount: 5 + next(500),
      type,
      category,
      accountId: next(2) === 0 ? 'a1' : 'a2',
      savingId: category === 'Ahorro' ? 's1' : undefined,
      refundId: type === 'income' && next(5) === 0 ? 'r1' : undefined,
    }));
  }

  const index = buildPeriodIndex(transactions);
  const initial = { a1: 1200, a2: 150 };

  for (const accountId of ['a1', 'a2']) {
    for (const period of ['2024-01', '2024-07', '2025-02', '2025-12', '2026-06', '2026-12', '2025', '2026']) {
      const expected = historicalBalance(transactions, initial[accountId], accountId, period);
      const actual = initial[accountId] + accountDeltaAt(index, accountId, period);
      assert.equal(actual, expected, `${accountId} en ${period}`);
    }
  }
});

test('el saldo de hucha del indice coincide con el bucle original', () => {
  // Bucle tal cual esta hoy en App.tsx:480-495: en huchas, expense suma.
  const historicalSaving = (transactions, currentAmount, savingId, dateStr) => {
    let cutoff = dateStr;
    if (dateStr.length === 7) {
      const [y, m] = dateStr.split('-').map(Number);
      cutoff = `${dateStr}-${new Date(y, m, 0).getDate()}`;
    }
    let balance = currentAmount;
    transactions.filter(t => t.savingId === savingId && t.date <= cutoff).forEach(t => {
      balance += (t.type === 'expense' ? t.amount : -t.amount);
    });
    return balance;
  };

  const transactions = [
    tx({ date: '2026-01-10', amount: 100, type: 'expense', category: 'Ahorro', savingId: 's1' }),
    tx({ date: '2026-03-10', amount: 250, type: 'expense', category: 'Ahorro', savingId: 's1' }),
    tx({ date: '2026-05-10', amount: 80, type: 'income', category: 'Ahorro', savingId: 's1' }),
  ];
  const index = buildPeriodIndex(transactions);
  for (const period of ['2025-12', '2026-01', '2026-02', '2026-04', '2026-12']) {
    assert.equal(
      3000 + savingDeltaAt(index, 's1', period),
      historicalSaving(transactions, 3000, 's1', period),
      period,
    );
  }
});

// ---------------------------------------------------------------------------
// Cifras del widget principal y objetivos de ahorro
// ---------------------------------------------------------------------------

test('las cifras de cabecera usan las definiciones del widget principal', () => {
  // Replica literal del calculo de Dashboard.tsx (metrics) sobre las mismas transacciones.
  const transactions = [
    tx({ date: '2026-09-01', amount: 2000, type: 'income', category: 'Nomina' }),
    tx({ date: '2026-09-02', amount: 600, type: 'expense', category: 'Vivienda' }),
    tx({ date: '2026-09-03', amount: 50, type: 'income', category: 'Ocio', refundId: 'r1' }),
    tx({ date: '2026-09-04', amount: 300, type: 'expense', category: 'Ahorro', savingId: 's1' }),
    tx({ date: '2026-09-05', amount: 120, type: 'income', category: 'Ahorro', savingId: 's1' }),
    tx({ date: '2026-09-06', amount: 500, type: 'expense', category: 'Traspaso' }),
  ];
  const isSaving = t => t.category === 'Ahorro' || t.category === 'Ahorros' || !!t.savingId;
  const isTransfer = t => t.category === 'Traspaso' || t.category === 'Transferencia';
  const baseIncome = transactions.filter(t => t.type === 'income' && !t.refundId && !isSaving(t) && !isTransfer(t)).reduce((s, t) => s + t.amount, 0);
  const refunds = transactions.filter(t => t.type === 'income' && t.refundId).reduce((s, t) => s + t.amount, 0);
  const baseSpending = transactions.filter(t => t.type === 'expense' && !isSaving(t) && !isTransfer(t)).reduce((s, t) => s + t.amount, 0);
  const withdrawals = transactions.filter(t => t.type === 'income' && isSaving(t)).reduce((s, t) => s + t.amount, 0);
  const deposits = transactions.filter(t => t.type === 'expense' && isSaving(t)).reduce((s, t) => s + t.amount, 0);
  const expense = Math.max(0, baseSpending - refunds);

  const headline = periodHeadline(aggregatePeriod(buildPeriodIndex(transactions), '2026-09'));
  assert.equal(headline.income, baseIncome + withdrawals);
  assert.equal(headline.expense, expense);
  assert.equal(headline.saving, deposits, 'ahorro = dinero movido a huchas, no el resultado del mes');
  assert.equal(headline.result, baseIncome + withdrawals - expense - deposits);
});

test('aportado y retirado por hucha, en mes y en anio', () => {
  const transactions = [
    tx({ date: '2026-08-10', amount: 100, type: 'expense', category: 'Ahorro', savingId: 's1' }),
    tx({ date: '2026-09-10', amount: 250, type: 'expense', category: 'Ahorro', savingId: 's1' }),
    tx({ date: '2026-09-12', amount: 40, type: 'income', category: 'Ahorro', savingId: 's1' }),
    tx({ date: '2026-09-15', amount: 70, type: 'expense', category: 'Ahorro', savingId: 's2' }),
  ];
  const index = buildPeriodIndex(transactions);
  assert.equal(JSON.stringify(savingFlow(index, 's1', '2026-09')), JSON.stringify({ deposits: 250, withdrawals: 40 }));
  assert.equal(JSON.stringify(savingFlow(index, 's1', '2026')), JSON.stringify({ deposits: 350, withdrawals: 40 }));
  assert.equal(savingFlow(index, 's2', '2026-08').deposits, 0);
  assert.equal(savingFlow(index, 'no-existe', '2026-09').deposits, 0);
});

test('las aportaciones por hucha respetan el porcentaje de la hucha', () => {
  const transactions = [tx({ date: '2026-09-10', amount: 200, type: 'expense', category: 'Ahorro', savingId: 's1' })];
  const index = buildPeriodIndex(transactions, { savings: { s1: 0.5 } });
  assert.equal(savingFlow(index, 's1', '2026-09').deposits, 100);
});

test('categorias de ingreso ordenadas, sin reembolsos', () => {
  const transactions = [
    tx({ date: '2026-09-01', amount: 2000, type: 'income', category: 'Nomina' }),
    tx({ date: '2026-09-02', amount: 300, type: 'income', category: 'Ventas' }),
    tx({ date: '2026-09-03', amount: 900, type: 'income', category: 'Ocio', refundId: 'r1' }),
  ];
  const rows = topCategories(aggregatePeriod(buildPeriodIndex(transactions), '2026-09'), 'income', 0);
  assert.equal(rows.map(r => r.category).join(','), 'Nomina,Ventas');
});
