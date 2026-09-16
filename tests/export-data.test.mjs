import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './_load.mjs';

const E = loadModule('../services/exportData.ts');
const { pickState, STATE_KEYS, fullBackup } = E;

const estado = {
  accounts: [{ id: 'a1', name: 'Banco Principal' }, { id: 'a2', name: 'Efectivo' }],
  savings: [{ id: 's1', name: 'Fondo Emergencia' }],
  budgets: [{ id: 'b1', category: 'Ocio', type: 'expense', limit: 100, period: '2026-09' }],
  refunds: [],
  transactions: [
    { id: 't2', date: '2026-09-05', description: 'Nomina', category: 'Nomina', type: 'income', amount: 2000, accountId: 'a1', isRefund: false },
    { id: 't1', date: '2026-09-01', description: 'Cena', category: 'Ocio', type: 'expense', amount: 42.5, accountId: 'a1', isRefund: false },
    { id: 't3', date: '2026-09-10', description: 'A la hucha', category: 'Ahorro', type: 'expense', amount: 300, accountId: 'a1', savingId: 's1', isRefund: false },
  ],
};

test('las transacciones salen ordenadas por fecha, no en el orden interno', () => {
  const csv = E.transactionsToCsv(estado);
  const filas = csv.split('\r\n');
  assert.match(filas[0], /^Fecha;Descripcion;Categoria;Tipo;Importe;Cuenta;Hucha;Reembolso$/);
  assert.match(filas[1], /^2026-09-01;Cena/);
  assert.match(filas[2], /^2026-09-05;Nomina/);
  assert.match(filas[3], /^2026-09-10;A la hucha/);
});

test('los importes usan coma decimal, que es lo que entiende Excel en español', () => {
  assert.equal(E.formatAmount(42.5), '42,50');
  assert.equal(E.formatAmount(2000), '2000,00');
  assert.equal(E.formatAmount('no soy un numero'), '0,00');
  assert.equal(E.formatAmount(null), '0,00');
  assert.match(E.transactionsToCsv(estado), /42,50/);
});

test('los identificadores internos se traducen a nombres legibles', () => {
  const csv = E.transactionsToCsv(estado);
  assert.match(csv, /Banco Principal/);
  assert.match(csv, /Fondo Emergencia/);
  assert.ok(csv.indexOf('a1') === -1, 'no deben aparecer ids de cuenta');
  assert.ok(csv.indexOf('s1') === -1, 'no deben aparecer ids de hucha');
});

test('distingue el tipo real del movimiento', () => {
  const csv = E.transactionsToCsv(estado);
  assert.match(csv, /Aportacion a hucha/);
  assert.match(csv, /Ingreso/);
  assert.match(csv, /Gasto/);
});

test('escapa separadores, comillas y saltos de linea', () => {
  assert.equal(E.escapeCsv('Compra; urgente'), '"Compra; urgente"');
  assert.equal(E.escapeCsv('Dijo "hola"'), '"Dijo ""hola"""');
  assert.equal(E.escapeCsv('linea1\nlinea2'), '"linea1\nlinea2"');
  assert.equal(E.escapeCsv('normal'), 'normal');
  assert.equal(E.escapeCsv(null), '');
});

test('una descripcion con punto y coma no rompe las columnas', () => {
  const csv = E.transactionsToCsv({
    ...estado,
    transactions: [{ id: 't', date: '2026-09-01', description: 'Bar; copas', category: 'Ocio', type: 'expense', amount: 10, accountId: 'a1', isRefund: false }],
  });
  const fila = csv.split('\r\n')[1];
  assert.match(fila, /"Bar; copas"/);
  // 8 columnas: el punto y coma de dentro no cuenta porque va entrecomillado.
  assert.equal(fila.split('";"').length + fila.replace(/"[^"]*"/g, '').split(';').length - 1, 8);
});

test('la copia completa lleva el estado entero y un resumen', () => {
  const json = E.fullBackup(estado, new Date('2026-09-13T16:30:00Z'));
  const parsed = JSON.parse(json);
  assert.equal(parsed.formato, 'finanzas-pro-ai/copia-de-seguridad');
  assert.equal(parsed.resumen.transacciones, 3);
  assert.equal(parsed.resumen.cuentas, 2);
  assert.equal(parsed.estado.transactions.length, 3);
});

test('la copia se puede volver a leer: exportar e importar son simetricos', () => {
  const json = E.fullBackup(estado, new Date('2026-09-13T16:30:00Z'));
  const recuperado = E.parseBackup(json);
  assert.equal(recuperado.transactions.length, 3);
  assert.equal(JSON.stringify(recuperado), JSON.stringify(estado));
});

test('tolera un volcado crudo del estado, no solo el formato propio', () => {
  const recuperado = E.parseBackup(JSON.stringify(estado));
  assert.equal(recuperado.transactions.length, 3);
});

test('un fichero que no es una copia devuelve null en vez de romper', () => {
  assert.equal(E.parseBackup('esto no es json'), null);
  assert.equal(E.parseBackup('{"otra":"cosa"}'), null);
  assert.equal(E.parseBackup(''), null);
});

test('el nombre de fichero lleva fecha y hora para que no se pisen copias', () => {
  const nombre = E.backupFilename('finanzas', 'json', new Date(2026, 8, 13, 9, 5));
  assert.equal(nombre, 'finanzas_2026-09-13_09-05.json');
});

test('exportar no modifica el estado', () => {
  const copia = JSON.stringify(estado);
  E.transactionsToCsv(estado);
  E.accountsToCsv(estado);
  E.budgetsToCsv(estado);
  E.fullBackup(estado, new Date());
  assert.equal(JSON.stringify(estado), copia);
});

test('aguanta un estado vacio o incompleto', () => {
  assert.match(E.transactionsToCsv({}), /^Fecha;/);
  assert.match(E.accountsToCsv({ accounts: null }), /^Nombre;/);
  assert.equal(JSON.parse(E.fullBackup({}, new Date())).resumen.transacciones, 0);
});

// ---------------------------------------------------------------------------
// Las claves del estado estaban enumeradas a mano en dos sitios de App.tsx. Una
// coleccion nueva se olvidaba en uno de los dos y la copia salia incompleta.
// ---------------------------------------------------------------------------

test('la copia lleva todas las claves del estado y ninguna funcion', () => {
  const contexto = {
    accounts: [{ id: 'a1' }], savings: [], refunds: [], transactions: [{ id: 't1' }],
    budgets: [], challenges: [], extraSavings: [], manualContributions: {},
    currentDate: '2026-09', viewMode: 'month', dashboardLayout: ['balance'], theme: 'dark',
    chatHistory: [], chatLastDate: '', budgetExclusions: {}, auraReports: {},
    expenseReminders: [{ id: 'r1' }],
    // Lo que useFinance() mezcla con el estado y no debe viajar:
    addTransaction: () => {}, deleteAccount: () => {}, isSyncing: false,
  };

  const plano = pickState(contexto);
  for (const clave of STATE_KEYS) {
    assert.ok(Object.hasOwn(plano, clave), 'falta la clave ' + clave);
  }
  assert.equal(Object.hasOwn(plano, 'addTransaction'), false, 'no viajan funciones');
  assert.equal(Object.hasOwn(plano, 'isSyncing'), false, 'ni el estado de la UI');

  const copia = JSON.parse(fullBackup(plano, new Date('2026-09-16T10:00:00Z')));
  assert.equal(copia.estado.expenseReminders.length, 1, 'los recordatorios entran en la copia');
  assert.equal(copia.resumen.transacciones, 1);
});

test('pickState aguanta un estado nulo o a medias', () => {
  assert.equal(Object.keys(pickState(null)).length, 0);
  assert.equal(Object.keys(pickState(undefined)).length, 0);
  assert.equal(Object.keys(pickState({ transactions: [] })).length, 1);
});
