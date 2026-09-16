import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './_load.mjs';

const guard = loadModule('../services/stateGuard.ts');
const V = loadModule('../services/versionHistory.ts', { './stateGuard': guard });

const tx = n => Array.from({ length: n }, (_, i) => ({ id: 't' + i }));
const estado = (n = 300) => ({
  transactions: tx(n),
  accounts: [{ id: 'a1' }, { id: 'a2' }],
  savings: [{ id: 's1' }],
  budgets: [{ id: 'b1' }],
  refunds: [],
});
const instantanea = (at, n) => ({ at, summary: guard.summarize(estado(n)) });

const HORA = 3600000;
const DIEZ_MIN = 600000;

test('la primera version de la sesion siempre se guarda', () => {
  const d = V.shouldSnapshot(null, estado(), HORA);
  assert.equal(d.snapshot, true);
  assert.match(d.reason, /primera version/);
});

test('no se guarda una version en cada guardado automatico', () => {
  const ultima = instantanea(HORA, 300);
  // Dos segundos despues, con un cambio: todavia no toca.
  assert.equal(V.shouldSnapshot(ultima, estado(301), HORA + 2000).snapshot, false);
});

test('pasados diez minutos con cambios, se guarda', () => {
  const ultima = instantanea(HORA, 300);
  const d = V.shouldSnapshot(ultima, estado(305), HORA + DIEZ_MIN);
  assert.equal(d.snapshot, true);
  assert.match(d.reason, /cambios acumulados/);
});

test('sin cambios no se guarda, por mucho tiempo que pase', () => {
  const ultima = instantanea(HORA, 300);
  assert.equal(V.shouldSnapshot(ultima, estado(300), HORA + 5 * HORA).snapshot, false);
});

test('si bajan las transacciones se guarda al momento, sin esperar', () => {
  // Es el caso que importa: si algo esta a punto de desaparecer, la version
  // anterior es justo la que hay que conservar.
  const ultima = instantanea(HORA, 300);
  const d = V.shouldSnapshot(ultima, estado(299), HORA + 2000);
  assert.equal(d.snapshot, true);
  assert.match(d.reason, /bajan las transacciones/);
});

test('nunca se guarda una version vacia: seria consagrar el accidente', () => {
  const vacio = { transactions: [], accounts: [], savings: [], budgets: [], refunds: [] };
  assert.equal(V.shouldSnapshot(null, vacio, HORA).snapshot, false);
  assert.equal(V.shouldSnapshot(instantanea(HORA, 300), vacio, HORA + HORA).snapshot, false);
});

test('aguanta estados nulos o corruptos', () => {
  assert.equal(V.shouldSnapshot(null, null, HORA).snapshot, false);
  assert.equal(V.shouldSnapshot(null, { transactions: 'no soy un array' }, HORA).snapshot, false);
});

test('la descripcion es legible', () => {
  assert.equal(V.describeSummary(guard.summarize(estado(12))), '12 movimientos, 2 cuentas, 1 huchas');
});

test('cambiar solo los recordatorios ya cuenta como trabajo del usuario', () => {
  const antes = { transactions: [{ id: 't1' }], accounts: [{ id: 'a1' }], savings: [], budgets: [], refunds: [], expenseReminders: [] };
  const despues = { ...antes, expenseReminders: [{ id: 'r1' }] };
  const ultima = { at: 1, summary: guard.summarize(antes) };
  const decision = V.shouldSnapshot(ultima, despues, 11 * 60 * 1000);
  assert.equal(decision.snapshot, true);
});
