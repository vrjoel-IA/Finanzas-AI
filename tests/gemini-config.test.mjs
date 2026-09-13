import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';

// Carga el nucleo del proxy sin red: solo se inspecciona su configuracion.
const require_ = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../netlify/functions/gemini-core.mts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} });
const mod = { exports: {} };
vm.runInNewContext(outputText, {
  exports: mod.exports, module: mod,
  require: name => {
    if (name === '@google/genai') return require_('@google/genai');
    throw new Error(`Forbidden dependency: ${name}`);
  },
  console, process, fetch, Response, Request, JSON, Math, Number, Date, Object, Array, String, RegExp, Error, Promise,
}, { filename: 'gemini-core.mts' });

const {
  functionDeclarations, ADVISOR_SYSTEM_INSTRUCTION, MODEL_CHAT, MODEL_CHALLENGES, MODEL_RECEIPTS,
  ACTION_NAMES, monthReportSchema, MONTH_REPORT_PROMPT, RECEIPT_MIME_TYPES,
} = mod.exports;

test('el proxy admite el informe de Aura y conserva las acciones anteriores', () => {
  for (const name of ['analyzeReceipt', 'generateChallenges', 'financialAdvice', 'monthReport']) {
    assert.ok(ACTION_NAMES.indexOf(name) !== -1, `falta la accion ${name}`);
  }
});

test('el informe de Aura tiene un esquema cerrado y no pide recalcular', () => {
  assert.equal([...monthReportSchema.required].sort().join(','), 'consejo,puntos,titular');
  assert.match(MONTH_REPORT_PROMPT, /No recalcules/);
  assert.match(MONTH_REPORT_PROMPT, /inventes cifras/);
});

test('el escaner acepta capturas PNG ademas de fotos JPEG', () => {
  assert.ok(RECEIPT_MIME_TYPES.indexOf('image/png') !== -1);
  assert.ok(RECEIPT_MIME_TYPES.indexOf('image/jpeg') !== -1);
});

// Los nombres que el cliente sabe convertir en propuestas. Si aqui se declara una
// accion que advisorActions no conoce, Aura la propondra y fallara al prepararla.
const ACCIONES_SOPORTADAS = [
  'goToPeriod', 'setViewMode', 'toggleTheme',
  'createBudgetCategory', 'updateExistingBudgetLimit', 'deleteBudgetCategory', 'importBudgetsFromMonth',
  'recordNewTransaction', 'updateExistingTransaction', 'deleteExistingTransaction',
  'createSavingsGoal', 'updateSavingsGoal', 'deleteSavingsGoal',
  'createAccount', 'renameAccount', 'markRefundAsSettled',
];

test('cada accion declarada a Gemini tiene su constructor en el cliente', () => {
  // Se comparan como texto: los arrays vienen de otro realm del VM y
  // deepStrictEqual compararia tambien los prototipos.
  const declaradas = functionDeclarations.map(d => d.name).sort().join(', ');
  assert.equal(declaradas, [...ACCIONES_SOPORTADAS].sort().join(', '));
});

test('ninguna declaracion esta mal formada', () => {
  for (const d of functionDeclarations) {
    assert.ok(d.name && typeof d.name === 'string', 'falta el nombre');
    assert.ok(d.description && d.description.length > 10, `descripción pobre en ${d.name}`);
    assert.ok(d.parameters && d.parameters.properties, `faltan parameters en ${d.name}`);
    for (const campo of d.parameters.required || []) {
      assert.ok(campo in d.parameters.properties, `${d.name}: "${campo}" es obligatorio pero no está declarado`);
    }
  }
});

// gemini-3-pro-preview desaparecio sin aviso y dejo el chat devolviendo 404
// mientras el escaner de tickets seguia funcionando. Este test no puede impedir
// que Google retire un modelo, pero si obliga a que la eleccion sea deliberada.
test('el chat y los retos usan modelos estables, no -preview', () => {
  assert.doesNotMatch(MODEL_CHAT, /-preview/, 'el chat no debe depender de un modelo preview');
  assert.doesNotMatch(MODEL_CHALLENGES, /-preview/, 'los retos no deben depender de un modelo preview');
});

test('el escaner de tickets documenta su riesgo si sigue en preview', () => {
  if (/-preview/.test(MODEL_RECEIPTS)) {
    assert.match(source, /revalidar la extraccion|revalidar la extracción/,
      'si el escáner usa un modelo preview, el código debe avisar de que habrá que revalidarlo');
  }
});

test('el prompt describe el modelo de confirmacion y los limites', () => {
  for (const idea of ['confirmar', 'nombre EXACTO', 'no puedes mover dinero real'.slice(0, 20)]) {
    assert.ok(ADVISOR_SYSTEM_INSTRUCTION.toLowerCase().includes(idea.toLowerCase()), `el prompt no menciona: ${idea}`);
  }
});
