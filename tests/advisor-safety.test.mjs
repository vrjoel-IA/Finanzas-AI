import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Compile in memory. Only explicitly supplied modules can load: never App, Gemini,
// Supabase, environment files, browser storage or a live session.
function load(relativePath, modules = {}) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React, esModuleInterop: true,
  } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require(name) {
    if (Object.hasOwn(modules, name)) return modules[name];
    throw new Error(`Forbidden dependency: ${name}`);
  }, console, Date, Set }, { filename: relativePath });
  return exports;
}
const actions = load('../components/advisorActions.ts');
const AdvisorText = load('../components/AdvisorText.tsx', { react: React }).default;
const fixture = () => ({
  accounts: [{ id: 'a1', name: 'Banco', type: 'Bank', initialBalance: 500, currentBalance: 500, color: 'blue' }],
  budgets: [{ id: 'b1', category: 'Ocio', limit: 100, period: '2026-09', type: 'expense', color: 'blue', icon: 'x', spent: 20 }],
  transactions: [{ id: 't1', amount: 20, type: 'expense', accountId: 'a1', date: '2026-09-01', category: 'Ocio', description: 'Existente', isRefund: false }],
  refunds: [], currentDate: '2026-09',
});
const updateCall = { name: 'updateExistingBudgetLimit', args: { categoryName: 'Ocio', newLimit: 150 } };
const transactionCall = { name: 'recordNewTransaction', args: { description: 'Nuevo', amount: 12, category: 'Ocio', type: 'expense', accountName: 'Banco' } };
const prepare = (call, context) => actions.prepareAdvisorProposal(call.name, call.args, context, 1, '2026-09-12');

test('chat escapes HTML while retaining accents, bold, italics and line breaks', () => {
  const text = '**Hola** *José*\n<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const history = [{ role: 'ai', text }];
  const before = JSON.stringify(history);
  const html = renderToStaticMarkup(React.createElement(AdvisorText, { text: history[0].text }));
  assert.match(html, /<strong[^>]*>Hola<\/strong>/);
  assert.match(html, /<em[^>]*>José<\/em>/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|<script|<svg/);
  assert.equal((html.match(/<p /g) || []).length, 2);
  assert.equal(JSON.stringify(history), before);
});

test('preparation preserves all existing fields and explicit confirmation changes only the requested limit', () => {
  const state = fixture();
  const before = JSON.stringify(state);
  const proposal = prepare(updateCall, state);
  assert.equal(JSON.stringify(state), before);
  const calls = [];
  actions.applyAdvisorProposal(proposal, state, { updateBudget: value => calls.push(value) });
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(calls[0]), JSON.stringify({ ...state.budgets[0], limit: 150 }));
  assert.equal(JSON.stringify(state), before);
});

test('new transactions are blocked whenever an existing refund could be recalculated', () => {
  const state = fixture();
  state.refunds.push({ id: 'r1', pendingAmount: 20, status: 'closed' });
  const before = JSON.stringify(state);
  assert.throws(() => prepare(transactionCall, state), /reembolsos/);
  assert.equal(JSON.stringify(state), before);
});

test('duplicate, ambiguous, legacy and invalid proposals are rejected without changing data', () => {
  const state = fixture();
  const before = JSON.stringify(state);
  assert.throws(() => prepare({ name: 'createBudgetCategory', args: { categoryName: ' ocio ', type: 'expense', limit: 80 } }, state), /ya existe/);
  for (const newLimit of [-1, NaN, Infinity, '15', null]) {
    assert.throws(() => prepare({ ...updateCall, args: { ...updateCall.args, newLimit } }, state), /importe/);
  }
  assert.throws(() => prepare(updateCall, { ...state, currentDate: '2026' }), /mes/);
  assert.throws(() => prepare(updateCall, { ...state, budgets: [{ ...state.budgets[0], period: undefined }] }), /único/);
  assert.throws(() => prepare(updateCall, { ...state, budgets: [...state.budgets, { ...state.budgets[0], id: 'b2' }] }), /único/);
  assert.throws(() => prepare(transactionCall, { ...state, accounts: [...state.accounts, { ...state.accounts[0], id: 'a2' }] }), /única/);
  assert.equal(JSON.stringify(state), before);
});

test('any changed financial context invalidates confirmation before a write callback', () => {
  const original = fixture();
  const proposal = prepare(updateCall, original);
  for (const key of ['accounts', 'budgets', 'transactions', 'refunds', 'currentDate']) {
    const changed = structuredClone(original);
    if (key === 'currentDate') changed[key] = '2026-10';
    else changed[key].push({ id: 'new' });
    assert.throws(() => actions.applyAdvisorProposal(proposal, changed, {
      updateBudget() { assert.fail('No write allowed'); },
    }), /han cambiado/);
  }
});

function harness(response) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const cleanups = [];
  const writes = [];
  const state = { ...fixture(), chatHistory: [{ role: 'ai', text: 'Historial existente' }],
    chatLastDate: new Date().toISOString().split('T')[0], theme: 'light',
    getAccountHistoricalBalance: () => 480,
    updateChatHistory: value => writes.push(['chat', value]),
    addBudget: value => writes.push(['createBudget', value]),
    updateBudget: value => writes.push(['updateBudget', value]),
    addTransaction: value => writes.push(['createTransaction', value]),
  };
  const hooks = { ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo: callback => callback(),
    useEffect(callback, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous[i])) effects.push(callback);
      slots[index] = deps;
    },
  };
  const Component = load('../components/AIAdvisor.tsx', {
    react: hooks, '../App': { useFinance: () => state },
    'lucide-react': new Proxy({}, { get: () => () => null }),
    '../services/geminiService': { getFinancialAdviceWithTools: async () => typeof response === 'function' ? response() : response },
    './AdvisorText': { default: AdvisorText, __esModule: true }, './advisorActions': actions,
  }).default;
  let tree;
  function render() {
    cursor = 0;
    tree = Component();
    const pending = effects;
    effects = [];
    pending.forEach(callback => { const cleanup = callback(); if (typeof cleanup === 'function') cleanups.push(cleanup); });
    return tree;
  }
  function nodes(node = tree) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(child => nodes(child));
    return [node, ...nodes(node.props?.children ?? null)];
  }
  const button = label => nodes().find(node => node.type === 'button' && node.props.children === label);
  async function send() {
    render(); render();
    nodes().find(node => node.type === 'input').props.onChange({ target: { value: 'Proponer un cambio' } });
    render();
    const promise = nodes().find(node => node.type === 'button' && node.props.onClick?.name === 'handleSend').props.onClick();
    await promise;
    render();
  }
  return { state, writes, send, render, button, nodes, unmount: () => cleanups.forEach(callback => callback()) };
}

test('actual advisor response requires confirmation; discard performs no financial write', async () => {
  const ui = harness({ functionCalls: [updateCall], text: 'Propuesta' });
  const before = JSON.stringify(ui.state);
  await ui.send();
  assert.equal(ui.writes.filter(([kind]) => kind !== 'chat').length, 0);
  assert.ok(ui.button('Confirmar este cambio'));
  ui.button('Descartar').props.onClick();
  ui.render();
  assert.equal(ui.button('Confirmar este cambio'), undefined);
  assert.equal(ui.writes.filter(([kind]) => kind !== 'chat').length, 0);
  assert.equal(JSON.stringify(ui.state), before);
});

test('confirmation is applied once despite repeated clicks and preserves the other budget fields', async () => {
  const ui = harness({ functionCalls: [updateCall] });
  await ui.send();
  const confirm = ui.button('Confirmar este cambio').props.onClick;
  confirm(); confirm();
  const financial = ui.writes.filter(([kind]) => kind !== 'chat');
  assert.equal(financial.length, 1);
  assert.equal(JSON.stringify(financial[0][1]), JSON.stringify({ ...ui.state.budgets[0], limit: 150 }));
});

test('a changed month blocks confirmation in the actual advisor component', async () => {
  const ui = harness({ functionCalls: [updateCall] });
  await ui.send();
  ui.state.currentDate = '2026-10';
  ui.render();
  ui.button('Confirmar este cambio').props.onClick();
  assert.equal(ui.writes.filter(([kind]) => kind !== 'chat').length, 0);
});

test('transaction proposal cannot invoke the existing refund recalculation', async () => {
  const ui = harness({ functionCalls: [transactionCall] });
  ui.state.refunds.push({ id: 'r1', pendingAmount: 20, status: 'closed' });
  const before = JSON.stringify(ui.state);
  await ui.send();
  assert.equal(ui.button('Confirmar este cambio'), undefined);
  assert.equal(ui.writes.filter(([kind]) => kind !== 'chat').length, 0);
  assert.equal(JSON.stringify(ui.state), before);
});

test('safe creation proposals require confirmation and preserve all existing fixture elements', async () => {
  for (const call of [transactionCall, { name: 'createBudgetCategory', args: { categoryName: 'Transporte', type: 'expense', limit: 50 } }]) {
    const ui = harness({ functionCalls: [call] });
    const before = JSON.stringify(ui.state);
    await ui.send();
    assert.equal(ui.writes.filter(([kind]) => kind !== 'chat').length, 0);
    ui.button('Confirmar este cambio').props.onClick();
    const financial = ui.writes.filter(([kind]) => kind !== 'chat');
    assert.equal(financial.length, 1);
    assert.equal(financial[0][0], call === transactionCall ? 'createTransaction' : 'createBudget');
    assert.equal(JSON.stringify(ui.state), before);
  }
});

test('confirming one proposal invalidates every other proposal from that response', async () => {
  const ui = harness({ functionCalls: [updateCall, transactionCall] });
  await ui.send();
  const buttons = ui.nodes().filter(node => node.type === 'button' && node.props.children === 'Confirmar este cambio');
  assert.equal(buttons.length, 2);
  buttons[0].props.onClick();
  buttons[1].props.onClick();
  assert.equal(ui.writes.filter(([kind]) => kind !== 'chat').length, 1);
});

test('leaving the advisor discards a late response without persisting it or executing actions', async () => {
  let resolve;
  const ui = harness(() => new Promise(done => { resolve = done; }));
  const pending = ui.send();
  ui.unmount();
  resolve({ functionCalls: [updateCall], text: 'Respuesta tardía' });
  await pending;
  assert.equal(ui.writes.length, 0);
  assert.equal(ui.button('Confirmar este cambio'), undefined);
});
