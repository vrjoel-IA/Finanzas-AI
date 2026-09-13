import type { Account, Saving } from '../types';
import type { IndexWeights } from './periodIndex';

// Titularidad parcial de una cuenta o una hucha: una cuenta conjunta con la
// pareja donde cada uno aporta la mitad.
//
// El libro contable NUNCA se pondera: los movimientos y el saldo de la cuenta
// se registran integros, para que cuadren con el extracto del banco. El
// porcentaje se aplica solo en las vistas de analisis.
//
// ownershipPercent es opcional: sin el, la cuenta es 100% tuya, que es como se
// comportaban todas las cuentas hasta ahora. Mismo patron que Refund.settledManually.

export const FULL_OWNERSHIP = 100;

/**
 * Convierte un porcentaje 0-100 en un peso 0-1.
 *
 * El parametro es `unknown` a proposito: el porcentaje llega de un JSON
 * persistido que nadie valida, y ahi un null o una cadena vacia significan "no
 * declarado", no "cero por ciento". Number(null) es 0, asi que confiar en el
 * tipo dejaria la cuenta al 0% del usuario y su dinero desapareceria del
 * analisis. Todo lo que no sea un numero utilizable es titularidad completa.
 */
export function ownershipWeight(pct?: unknown): number {
  if (pct === undefined || pct === null || pct === '') return 1;
  const n = Number(pct);
  if (!isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n / 100));
}

/** true si la entidad declara una titularidad parcial real. */
export function isShared(entity: { ownershipPercent?: number } | null | undefined): boolean {
  if (!entity) return false;
  const pct = entity.ownershipPercent;
  if (pct === undefined || pct === null || (pct as unknown) === '') return false;
  const n = Number(pct);
  return isFinite(n) && n < FULL_OWNERSHIP;
}

export const ownedAmount = (amount: number, pct?: unknown): number =>
  amount * ownershipWeight(pct);

/** Pesos por id, listos para buildPeriodIndex. */
export function buildIndexWeights(accounts: Account[], savings: Saving[]): IndexWeights {
  const accountWeights: Record<string, number> = {};
  const savingWeights: Record<string, number> = {};
  const accountList = Array.isArray(accounts) ? accounts : [];
  const savingList = Array.isArray(savings) ? savings : [];
  for (let i = 0; i < accountList.length; i++) {
    accountWeights[accountList[i].id] = ownershipWeight(accountList[i].ownershipPercent);
  }
  for (let i = 0; i < savingList.length; i++) {
    savingWeights[savingList[i].id] = ownershipWeight(savingList[i].ownershipPercent);
  }
  return { accounts: accountWeights, savings: savingWeights };
}

/** true si algo tiene titularidad parcial: si no, no hace falta ni ponderar ni ensenar el selector. */
export function hasSharedEntities(accounts: Account[], savings: Saving[]): boolean {
  const accountList = Array.isArray(accounts) ? accounts : [];
  const savingList = Array.isArray(savings) ? savings : [];
  for (let i = 0; i < accountList.length; i++) if (isShared(accountList[i])) return true;
  for (let i = 0; i < savingList.length; i++) if (isShared(savingList[i])) return true;
  return false;
}
