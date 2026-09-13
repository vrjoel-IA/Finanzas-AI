import type { FinanceState } from '../types';

// Guardia anti-destruccion.
//
// El 13 de septiembre de 2026 esta app borro el historial completo de un usuario.
// El mecanismo: entrar en Modo Local con la sesion abierta dejo el estado en los
// datos de ejemplo, el guardado automatico los escribio sobre la copia local de la
// cuenta, y en el siguiente arranque esa copia se subio a la nube por ser "mas
// reciente". Tres copias del mismo valor, y las tres se perdieron a la vez.
//
// Nada de esto habria pasado si alguien hubiera comprobado lo evidente: que un
// guardado que pasa de 300 transacciones a 0 no es un guardado, es un accidente.
// Este modulo es esa comprobacion. Es puro y no depende de React ni de la red.

export interface StateSummary {
  transactions: number;
  accounts: number;
  savings: number;
  budgets: number;
  refunds: number;
}

export interface DestructiveVerdict {
  destructive: boolean;
  /** Mensaje para el usuario. Vacio si el guardado es seguro. */
  reason: string;
  before: StateSummary;
  after: StateSummary;
}

/** Proporcion de perdida a partir de la cual se considera accidente. */
export const LOSS_THRESHOLD = 0.5;

const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

export function summarize(state: Partial<FinanceState> | null | undefined): StateSummary {
  const s = state || {};
  return {
    transactions: count(s.transactions),
    accounts: count(s.accounts),
    savings: count(s.savings),
    budgets: count(s.budgets),
    refunds: count(s.refunds),
  };
}

const ES: Record<keyof StateSummary, string> = {
  transactions: 'transacciones',
  accounts: 'cuentas',
  savings: 'huchas',
  budgets: 'presupuestos',
  refunds: 'reembolsos',
};

/**
 * Decide si escribir `next` encima de `previous` destruiria datos.
 *
 * Se vigilan solo las colecciones que representan trabajo del usuario. Cambiar
 * de mes, de tema o de orden de bloques no es destructivo por definicion.
 *
 * Criterios, por orden de gravedad:
 *  - pasar de tener registros a cero,
 *  - perder mas de la mitad de una coleccion de golpe.
 */
export function checkDestructiveWrite(
  previous: Partial<FinanceState> | null | undefined,
  next: Partial<FinanceState> | null | undefined,
): DestructiveVerdict {
  const before = summarize(previous);
  const after = summarize(next);
  const safe: DestructiveVerdict = { destructive: false, reason: '', before, after };

  // Sin referencia previa no hay nada que proteger: es el primer guardado.
  if (!previous) return safe;

  const keys: (keyof StateSummary)[] = ['transactions', 'accounts', 'savings', 'budgets', 'refunds'];
  const losses: string[] = [];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const had = before[key];
    const has = after[key];
    if (had === 0 || has >= had) continue;

    if (has === 0) {
      losses.push(`todas las ${ES[key]} (${had})`);
    } else if (had - has > had * LOSS_THRESHOLD) {
      losses.push(`${had - has} de ${had} ${ES[key]}`);
    }
  }

  if (!losses.length) return safe;

  return {
    destructive: true,
    reason: 'Este guardado eliminaria ' + losses.join(', ') + '.',
    before,
    after,
  };
}

/**
 * Detecta el estado semilla. Es el que aparece cuando la app arranca sin datos,
 * y el que se escribio encima del historial real: si va a sustituir a algo con
 * contenido, casi siempre es un accidente y no una decision.
 */
export function looksLikeSeedState(state: Partial<FinanceState> | null | undefined): boolean {
  const s = summarize(state);
  return s.transactions === 0 && s.refunds === 0 && s.accounts <= 2 && s.savings <= 2;
}
