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
  // El caso real: un usuario con su layout guardado antes de que existieran
  // la comparativa, el anillo y las tendencias.
  const guardado = ['balance', 'challenges', 'savings', 'chart', 'accounts', 'budget'];
  const resultado = mergeLayout(guardado);
  for (const clave of ['comparison', 'categories', 'trends']) {
    assert.ok(resultado.indexOf(clave) !== -1, 'falta el bloque ' + clave);
  }
  assert.equal(resultado.length, DASHBOARD_BLOCKS.length);
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
