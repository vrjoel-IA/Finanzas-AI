import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServices } from './_load.mjs';

const { dashboardBlocks } = loadServices();
const { mergeLayout, DASHBOARD_BLOCKS } = dashboardBlocks;

const asText = list => JSON.stringify(list);

test('sin layout guardado se usa el orden por defecto', () => {
  assert.equal(asText(mergeLayout(undefined)), asText(DASHBOARD_BLOCKS));
  assert.equal(asText(mergeLayout(null)), asText(DASHBOARD_BLOCKS));
  assert.equal(asText(mergeLayout([])), asText(DASHBOARD_BLOCKS));
});

test('se respeta el orden que el usuario haya elegido', () => {
  const guardado = ['budget', 'balance', 'accounts'];
  const resultado = mergeLayout(guardado);
  assert.equal(asText(resultado.slice(0, 3)), asText(guardado));
});

test('los bloques nuevos aparecen al final en vez de quedar invisibles', () => {
  // El caso real: un usuario con su layout guardado antes de que existiera
  // la comparativa.
  const guardado = ['balance', 'challenges', 'savings', 'chart', 'accounts', 'budget'];
  const resultado = mergeLayout(guardado);
  assert.ok(resultado.indexOf('comparison') !== -1, 'falta el bloque comparison');
  assert.equal(resultado.length, DASHBOARD_BLOCKS.length);
});

test('los bloques antiguos se traducen a su sustituto en su misma posicion', () => {
  const guardado = ['balance', 'challenges', 'savings', 'chart', 'accounts', 'budget'];
  assert.equal(
    asText(mergeLayout(guardado)),
    asText(['balance', 'report', 'savings', 'evolution', 'accounts', 'budget', 'comparison', 'reminders']),
  );
});

test('las dos graficas antiguas dan un unico bloque de evolucion, donde estaba la primera', () => {
  const resultado = mergeLayout(['trends', 'balance', 'chart', 'categories', 'budget']);
  assert.equal(resultado.filter(k => k === 'evolution').length, 1);
  assert.equal(resultado[0], 'evolution');
  assert.equal(resultado.indexOf('trends'), -1);
  assert.equal(resultado.indexOf('chart'), -1);
  assert.equal(resultado.indexOf('categories'), -1, 'el anillo vive ahora dentro de presupuestos');
});

test('un layout con los bloques antiguos y los nuevos no duplica nada', () => {
  const resultado = mergeLayout(['report', 'challenges', 'evolution', 'chart']);
  assert.equal(resultado.filter(k => k === 'report').length, 1);
  assert.equal(resultado.filter(k => k === 'evolution').length, 1);
  assert.equal(asText(mergeLayout(resultado)), asText(resultado));
});

test('no se pierde una clave desconocida', () => {
  // Compatibilidad hacia delante: si una version mas nueva anade un bloque y el
  // usuario vuelve a esta, su layout no debe quedar mutilado.
  const resultado = mergeLayout(['balance', 'bloque-del-futuro']);
  assert.ok(resultado.indexOf('bloque-del-futuro') !== -1);
});

test('se eliminan duplicados y basura', () => {
  const resultado = mergeLayout(['balance', 'balance', '', null, 42, 'budget']);
  assert.equal(resultado.filter(k => k === 'balance').length, 1);
  assert.ok(resultado.every(k => typeof k === 'string' && k.length > 0));
});

test('fusionar dos veces da el mismo resultado', () => {
  const una = mergeLayout(['budget', 'balance']);
  const dos = mergeLayout(una);
  assert.equal(asText(dos), asText(una));
});
