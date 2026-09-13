import type { Account, AIChallenge, Budget, Refund, Saving, Transaction } from '../types';

// Construye la foto financiera que recibe Aura. Antes solo veia nombres de cuenta
// y limites de presupuesto, asi que no podia responder sobre gastos concretos,
// huchas ni reembolsos. Es una funcion pura: no lee estado ni escribe nada.

export interface AdvisorContextInput {
  accounts: Account[];
  savings: Saving[];
  /** Presupuestos YA resueltos para currentDate (propios + heredados). */
  budgets: Budget[];
  transactions: Transaction[];
  refunds: Refund[];
  challenges: AIChallenge[];
  currentDate: string;
  viewMode: 'month' | 'year';
  accountBalance: (accountId: string, date: string) => number;
  savingBalance: (savingId: string, date: string) => number;
  netWorth: (date: string) => number;
}

const MAX_TRANSACTIONS = 120;
const MAX_HISTORY_MONTHS = 12;

const money = (value: number) => `${Math.round(Number(value) || 0)}€`;
const pct = (part: number, whole: number) => (whole > 0 ? ` (${Math.round((part / whole) * 100)}%)` : '');
const monthOf = (date: string) => date.slice(0, 7);

const sum = (items: Transaction[], type: 'income' | 'expense') =>
  items.reduce((total, t) => (t.type === type ? total + Number(t.amount || 0) : total), 0);

const block = (title: string, lines: string[]) =>
  lines.length ? `## ${title}\n${lines.join('\n')}` : `## ${title}\n(ninguno)`;

export function buildAdvisorContext(input: AdvisorContextInput): string {
  const { currentDate, viewMode } = input;
  const inPeriod = input.transactions.filter(t => (t.date || '').startsWith(currentDate));
  const accountName = new Map(input.accounts.map(a => [a.id, a.name]));

  const cuentas = input.accounts.map(a =>
    `- ${a.name} (${a.type}): ${money(input.accountBalance(a.id, currentDate))}`);

  const huchas = input.savings.map(s => {
    const amount = input.savingBalance(s.id, currentDate);
    const target = s.targetAmount ? ` de ${money(s.targetAmount)}${pct(amount, s.targetAmount)}` : '';
    return `- ${s.name}: ${money(amount)}${target}${s.isInvestment ? ' [inversión]' : ''}`;
  });

  // Gasto real por categoria, calculado desde las transacciones del periodo.
  const spentByCategory = new Map<string, number>();
  for (const t of inPeriod) {
    const key = `${t.category}|${t.type}`;
    spentByCategory.set(key, (spentByCategory.get(key) || 0) + Number(t.amount || 0));
  }

  // Llegan ya resueltos desde el contexto de la app, con la misma herencia que
  // ve el usuario en pantalla. Filtrar aqui por periodo dejaria a Aura dando
  // cifras que no coinciden con lo que el usuario esta mirando.
  const presupuestos = input.budgets
    .map(b => {
      const spent = spentByCategory.get(`${b.category}|${b.type}`) || 0;
      const label = b.type === 'income' ? 'ingresado' : 'gastado';
      return `- ${b.category} (${b.type === 'income' ? 'ingresos' : 'gastos'}): ${label} ${money(spent)} de ${money(b.limit)}${pct(spent, b.limit)}`;
    });

  // Categorias con movimiento pero sin presupuesto: suelen ser el punto ciego.
  const presupuestadas = new Set(input.budgets.map(b => `${b.category}|${b.type}`));
  const sinPresupuesto = [...spentByCategory.entries()]
    .filter(([key]) => !presupuestadas.has(key))
    .map(([key, value]) => `- ${key.split('|')[0]} (${key.split('|')[1] === 'income' ? 'ingresos' : 'gastos'}): ${money(value)} sin presupuesto asignado`);

  const movimientos = inPeriod
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, MAX_TRANSACTIONS)
    .map(t => `- ${t.date} | ${t.type === 'income' ? '+' : '-'}${money(t.amount)} | ${t.description} | ${t.category} | ${accountName.get(t.accountId) || 'cuenta desconocida'}${t.isRefund ? ' | genera reembolso' : ''}${t.refundId ? ' | ligado a reembolso' : ''}`);

  const reembolsos = input.refunds
    .filter(r => r.status === 'open')
    .map(r => `- ${r.name}: pendiente ${money(r.pendingAmount)} de ${money(r.totalAmount)} (puse ${money(r.paidByMe)})`);

  const retos = input.challenges
    .filter(c => !c.completed)
    .map(c => `- ${c.title}: objetivo ${money(c.target)}${c.category ? ` en ${c.category}` : ''}`);

  // Evolucion mensual, para poder comparar con meses anteriores.
  const byMonth = new Map<string, Transaction[]>();
  for (const t of input.transactions) {
    const month = monthOf(t.date || '');
    if (!month) continue;
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(t);
  }
  const historico = [...byMonth.keys()]
    .sort()
    .reverse()
    .slice(0, MAX_HISTORY_MONTHS)
    .map(month => {
      const items = byMonth.get(month)!;
      const income = sum(items, 'income');
      const expense = sum(items, 'expense');
      return `- ${month}: ingresos ${money(income)}, gastos ${money(expense)}, balance ${money(income - expense)}`;
    });

  const ingresos = sum(inPeriod, 'income');
  const gastos = sum(inPeriod, 'expense');

  return [
    `# Situación financiera`,
    `Periodo seleccionado: ${currentDate} (vista ${viewMode === 'month' ? 'mensual' : 'anual'}).`,
    `Patrimonio neto: ${money(input.netWorth(currentDate))}.`,
    `En el periodo: ingresos ${money(ingresos)}, gastos ${money(gastos)}, balance ${money(ingresos - gastos)}.`,
    ``,
    block('Cuentas', cuentas),
    block('Huchas', huchas),
    block('Presupuestos del periodo', presupuestos),
    block('Movimiento sin presupuesto', sinPresupuesto),
    block('Reembolsos pendientes', reembolsos),
    block('Retos activos', retos),
    block('Evolución mensual', historico),
    block(
      inPeriod.length > MAX_TRANSACTIONS
        ? `Movimientos del periodo (${MAX_TRANSACTIONS} más recientes de ${inPeriod.length})`
        : `Movimientos del periodo (${inPeriod.length})`,
      movimientos,
    ),
  ].join('\n');
}
