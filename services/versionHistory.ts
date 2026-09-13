import type { FinanceState } from '../types';
import { summarize } from './stateGuard';
import type { StateSummary } from './stateGuard';

// Cuando merece la pena guardar una version.
//
// El guardado automatico corre cada 2 segundos. Insertar una version en cada uno
// llenaria la tabla de ruido y haria inutil el historial justo cuando hace falta:
// buscando entre miles de filas identicas. Aqui se decide que guardar.
//
// Criterio: siempre la primera version de la sesion, siempre que cambie algo que
// represente trabajo del usuario, y como mucho una cada diez minutos.

export const MIN_INTERVAL_MS = 10 * 60 * 1000;

export interface Snapshot {
  at: number;
  summary: StateSummary;
}

export interface SnapshotDecision {
  snapshot: boolean;
  /** Por que se guarda. Va a la columna `reason` y sirve para entender el historial. */
  reason: string;
}

const NO: SnapshotDecision = { snapshot: false, reason: '' };

const differs = (a: StateSummary, b: StateSummary): boolean =>
  a.transactions !== b.transactions ||
  a.accounts !== b.accounts ||
  a.savings !== b.savings ||
  a.budgets !== b.budgets ||
  a.refunds !== b.refunds;

/**
 * @param last    ultima version guardada en esta sesion, o null si no hay
 * @param current estado que se acaba de guardar
 * @param now     marca de tiempo actual en ms
 */
export function shouldSnapshot(
  last: Snapshot | null | undefined,
  current: Partial<FinanceState> | null | undefined,
  now: number,
  minIntervalMs: number = MIN_INTERVAL_MS,
): SnapshotDecision {
  const summary = summarize(current);

  // Nunca se guarda una version vacia: seria consagrar el accidente.
  const total = summary.transactions + summary.accounts + summary.savings + summary.budgets + summary.refunds;
  if (total === 0) return NO;

  if (!last) return { snapshot: true, reason: 'primera version de la sesion' };

  const cambios = differs(last.summary, summary);
  const transcurrido = now - last.at;

  if (cambios && transcurrido >= minIntervalMs) {
    return { snapshot: true, reason: 'cambios acumulados' };
  }

  // Una perdida de datos se guarda al momento aunque sea reciente: si algo va a
  // desaparecer, la version de antes es la que hay que tener.
  if (summary.transactions < last.summary.transactions) {
    return { snapshot: true, reason: 'bajan las transacciones' };
  }

  if (!last.at) return { snapshot: true, reason: 'primera version de la sesion' };

  return NO;
}

/** Descripcion corta de una version, para la lista del historial. */
export function describeSummary(summary: StateSummary): string {
  return (
    summary.transactions + ' movimientos, ' +
    summary.accounts + ' cuentas, ' +
    summary.savings + ' huchas'
  );
}
