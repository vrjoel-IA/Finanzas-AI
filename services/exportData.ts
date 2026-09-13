import type { FinanceState, Transaction } from '../types';

// Exportacion de datos.
//
// La app guardaba todo en un unico JSON en la nube, sin historico y sin forma de
// sacarlo. Cuando ese JSON se corrompio no habia nada que hacer. Esto existe para
// que eso no vuelva a depender de nadie: una copia tuya, en tu disco, legible con
// cualquier hoja de calculo y reimportable.
//
// Modulo puro: sin React, sin red, sin Intl (los tests lo ejecutan en un sandbox).

/** Excel en español espera punto y coma; con la coma mete todo en una columna. */
export const CSV_SEP = ';';

const pad2 = (n: number): string => (n < 10 ? '0' + n : '' + n);

/** Importe con coma decimal, que es lo que entiende Excel en español. */
export function formatAmount(value: unknown): string {
  const n = Number(value);
  if (!isFinite(n)) return '0,00';
  return n.toFixed(2).replace('.', ',');
}

/** Escapa un campo: comillas dobladas, y entrecomillado si lleva separador o salto. */
export function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const needsQuotes =
    text.indexOf(CSV_SEP) !== -1 ||
    text.indexOf('"') !== -1 ||
    text.indexOf('\n') !== -1 ||
    text.indexOf('\r') !== -1;
  const escaped = text.split('"').join('""');
  return needsQuotes ? '"' + escaped + '"' : escaped;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines: string[] = [headers.map(escapeCsv).join(CSV_SEP)];
  for (let i = 0; i < rows.length; i++) {
    lines.push(rows[i].map(escapeCsv).join(CSV_SEP));
  }
  return lines.join('\r\n');
}

const nameIndex = (items: { id: string; name: string }[] | undefined): Record<string, string> => {
  const table: Record<string, string> = {};
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i++) table[list[i].id] = list[i].name;
  return table;
};

const tipoLegible = (t: Transaction): string => {
  if (t.savingId) return t.type === 'expense' ? 'Aportacion a hucha' : 'Retirada de hucha';
  if (t.category === 'Traspaso' || t.category === 'Transferencia') return 'Traspaso';
  if (t.type === 'income' && t.refundId) return 'Cobro de reembolso';
  return t.type === 'income' ? 'Ingreso' : 'Gasto';
};

export function transactionsToCsv(state: Partial<FinanceState>): string {
  const cuentas = nameIndex(state.accounts as any);
  const huchas = nameIndex(state.savings as any);
  const transactions = Array.isArray(state.transactions) ? state.transactions : [];

  const rows = transactions
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(t => [
      t.date,
      t.description,
      t.category,
      tipoLegible(t),
      formatAmount(t.amount),
      cuentas[t.accountId] || t.accountId || '',
      t.savingId ? huchas[t.savingId] || t.savingId : '',
      t.refundId ? 'si' : '',
    ]);

  return toCsv(
    ['Fecha', 'Descripcion', 'Categoria', 'Tipo', 'Importe', 'Cuenta', 'Hucha', 'Reembolso'],
    rows,
  );
}

export function accountsToCsv(state: Partial<FinanceState>): string {
  const accounts = Array.isArray(state.accounts) ? state.accounts : [];
  return toCsv(
    ['Nombre', 'Tipo', 'Saldo inicial'],
    accounts.map(a => [a.name, a.type, formatAmount(a.initialBalance)]),
  );
}

export function budgetsToCsv(state: Partial<FinanceState>): string {
  const budgets = Array.isArray(state.budgets) ? state.budgets : [];
  return toCsv(
    ['Periodo', 'Categoria', 'Tipo', 'Limite'],
    budgets.map(b => [
      b.period || '(todos los meses)',
      b.category,
      b.type === 'income' ? 'Ingreso' : b.type === 'saving' ? 'Ahorro' : 'Gasto',
      formatAmount(b.limit),
    ]),
  );
}

/**
 * Copia completa en JSON. Es la que sirve para restaurar: lleva todo el estado
 * tal cual, mas metadatos para saber de cuando es y que contiene.
 */
export function fullBackup(state: Partial<FinanceState>, now: Date): string {
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return JSON.stringify(
    {
      formato: 'finanzas-pro-ai/copia-de-seguridad',
      version: 1,
      exportado: now.toISOString(),
      resumen: {
        transacciones: count(state.transactions),
        cuentas: count(state.accounts),
        huchas: count(state.savings),
        presupuestos: count(state.budgets),
        reembolsos: count(state.refunds),
      },
      estado: state,
    },
    null,
    2,
  );
}

/** Nombre de fichero con fecha y hora, para que varias copias no se pisen. */
export function backupFilename(prefix: string, extension: string, now: Date): string {
  const stamp =
    now.getFullYear() +
    '-' + pad2(now.getMonth() + 1) +
    '-' + pad2(now.getDate()) +
    '_' + pad2(now.getHours()) +
    '-' + pad2(now.getMinutes());
  return prefix + '_' + stamp + '.' + extension;
}

/**
 * Lee una copia completa y devuelve el estado, o null si el fichero no lo es.
 * No valida el contenido a fondo a proposito: quien restaura ya vera el resumen
 * antes de confirmar.
 */
export function parseBackup(text: string): Partial<FinanceState> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.formato === 'finanzas-pro-ai/copia-de-seguridad' && parsed.estado) {
      return parsed.estado as Partial<FinanceState>;
    }
    // Tolerancia: un volcado crudo del estado tambien vale.
    if (parsed && Array.isArray(parsed.transactions)) return parsed as Partial<FinanceState>;
    return null;
  } catch (e) {
    return null;
  }
}
