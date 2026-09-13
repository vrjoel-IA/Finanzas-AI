import type { BudgetStatus, BudgetType } from '../services/budgetPlan';

// Tono de una tarjeta de presupuesto. La barra y la cifra conservan siempre el
// color propio de la categoria; lo que cambia es la tarjeta entera, para ver de
// un vistazo cual se ha pasado (rojo), que ingreso se ha logrado (verde) y que
// objetivo de ahorro se ha cumplido (ambar, el color del ahorro en la app).

export function budgetCardTone(type: BudgetType, status: BudgetStatus): string {
  if (status === 'over') return 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800';
  if (status === 'achieved') {
    return type === 'saving'
      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800'
      : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800';
  }
  return 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800';
}

/** Fondo de una fila compacta (widget del dashboard). */
export function budgetRowTone(type: BudgetType, status: BudgetStatus): string {
  if (status === 'over') return 'bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900';
  if (status === 'achieved') {
    return type === 'saving'
      ? 'bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900'
      : 'bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900';
  }
  return 'hover:bg-slate-50 dark:hover:bg-slate-800/50';
}

/** Etiqueta de estado a juego con la tarjeta. */
export function budgetBadgeTone(type: BudgetType, status: BudgetStatus): string {
  if (status === 'over') return 'bg-rose-600 text-white';
  if (status === 'achieved') return type === 'saving' ? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white';
  return '';
}

export function budgetBadgeLabel(type: BudgetType, status: BudgetStatus, progress: number): string {
  if (type === 'expense') return status === 'over' ? 'Excedido' : progress > 85 ? 'Cuidado' : 'Correcto';
  return status === 'achieved' ? 'Logrado' : 'En progreso';
}
