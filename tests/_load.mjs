// Cargador compartido de los modulos puros de services/.
// Se ejecutan en un vm sin acceso a nada del sistema: si alguno intentara
// importar React, fs o cualquier dependencia, el test falla al instante. Eso es
// justamente lo que garantiza que la logica de calculo sigue siendo pura.
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const SANDBOX = { console, Math, Number, JSON, Date, Object, Array, Set, Map, String, Boolean, isFinite, isNaN };

export function loadModule(relativePath, modules = {}) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const exports = {};
  const context = {
    ...SANDBOX,
    exports,
    require(name) {
      if (Object.hasOwn(modules, name)) return modules[name];
      throw new Error(`Forbidden dependency: ${name}`);
    },
  };
  vm.runInNewContext(outputText, context, { filename: relativePath });
  return exports;
}

export function loadServices() {
  const txClassify = loadModule('../services/txClassify.ts');
  const periods = loadModule('../services/periods.ts');
  const periodIndex = loadModule('../services/periodIndex.ts', {
    './txClassify': txClassify,
    './periods': periods,
  });
  const ownership = loadModule('../services/ownership.ts');
  const dashboardBlocks = loadModule('../services/dashboardBlocks.ts');
  const budgetPlan = loadModule('../services/budgetPlan.ts', {
    './periodIndex': periodIndex,
    './periods': periods,
  });
  const realisticProjection = loadModule('../services/realisticProjection.ts', {
    './periodIndex': periodIndex,
  });
  return { txClassify, periods, periodIndex, ownership, dashboardBlocks, budgetPlan, realisticProjection };
}
