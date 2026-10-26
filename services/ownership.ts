import type { Account, Saving, Transaction } from '../types';
import type { IndexWeights } from './periodIndex';
import { isTransferTx } from './txClassify';

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

// Aportaciones a la cuenta conjunta. El porcentaje vale para lo que se gasta
// desde ella, pero no para lo que entra: cada aportacion es entera de quien la
// hace. Si yo meto 27 y la otra persona 25, mi parte sube 27, no 26.
//
// Ninguna transaccion lleva quien aporto, y no se les anade el dato: se deduce.
// Mi aportacion es un traspaso desde una cuenta mia, asi que tiene su pareja
// (misma cantidad, signo contrario) en una cuenta no compartida. La de la otra
// persona llega desde fuera de la app y no tiene pareja. Igual al reves: sacar
// dinero a una cuenta mia es mio entero; un traspaso suelto hacia fuera, suyo.

/** Margen en dias entre las dos patas de un traspaso registradas por separado. */
export const TRANSFER_MATCH_DAYS = 3;

const dayNumber = (date: string): number => {
  const ms = Date.parse(String(date).slice(0, 10) + 'T00:00:00Z');
  return isFinite(ms) ? Math.round(ms / 86400000) : NaN;
};

/**
 * Peso de cada traspaso de una cuenta compartida: 1 si es mio (tiene pareja en
 * una cuenta no compartida), 0 si es de la otra persona. Los traspasos entre
 * dos cuentas compartidas no aparecen y siguen con el porcentaje de la cuenta.
 * Solo lee: no toca ninguna transaccion.
 */
export function buildTransferWeights(transactions: Transaction[], accounts: Account[]): Record<string, number> {
  const weights: Record<string, number> = {};
  const accountList = Array.isArray(accounts) ? accounts : [];
  const shared: Record<string, boolean> = {};
  let anyShared = false;
  for (let i = 0; i < accountList.length; i++) {
    if (isShared(accountList[i])) { shared[accountList[i].id] = true; anyShared = true; }
  }
  if (!anyShared) return weights;

  const list = Array.isArray(transactions) ? transactions : [];
  const sharedLegs: Transaction[] = [];
  const otherLegs: Transaction[] = [];
  const sharedPartners: Transaction[] = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t || !t.id || !t.accountId || t.savingId || !isTransferTx(t)) continue;
    if (shared[t.accountId]) { sharedLegs.push(t); sharedPartners.push(t); }
    else otherLegs.push(t);
  }
  sharedLegs.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const used: Record<string, boolean> = {};
  const findPartner = (t: Transaction, pool: Transaction[]): Transaction | null => {
    const day = dayNumber(t.date);
    const amount = Number(t.amount);
    let best: Transaction | null = null;
    let bestGap = Infinity;
    for (let j = 0; j < pool.length; j++) {
      const c = pool[j];
      if (used[c.id] || c.id === t.id || c.type === t.type || c.accountId === t.accountId) continue;
      if (Math.abs(Number(c.amount) - amount) > 0.005) continue;
      const gap = Math.abs(dayNumber(c.date) - day);
      if (!(gap <= TRANSFER_MATCH_DAYS) || gap >= bestGap) continue;
      best = c;
      bestGap = gap;
    }
    return best;
  };

  for (let i = 0; i < sharedLegs.length; i++) {
    const t = sharedLegs[i];
    if (used[t.id]) continue;
    const mine = findPartner(t, otherLegs);
    if (mine) {
      used[t.id] = true;
      used[mine.id] = true;
      weights[t.id] = 1;
      continue;
    }
    const between = findPartner(t, sharedPartners);
    if (between) {
      // Entre dos cuentas compartidas: se queda con el porcentaje de cada una.
      used[t.id] = true;
      used[between.id] = true;
      continue;
    }
    weights[t.id] = 0;
  }
  return weights;
}

/**
 * Mi parte del saldo de una cuenta al cierre de cutoffDate (YYYY-MM-DD): el
 * saldo inicial y los gastos con el porcentaje, los traspasos segun quien
 * aporto. Sin titularidad parcial coincide con el saldo integro.
 */
export function ownedAccountBalance(
  account: Account,
  transactions: Transaction[],
  cutoffDate: string,
  transferWeights: Record<string, number>,
): number {
  const share = ownershipWeight(account.ownershipPercent);
  let balance = Number(account.initialBalance) * share || 0;
  const list = Array.isArray(transactions) ? transactions : [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t || t.accountId !== account.id || !(t.date <= cutoffDate)) continue;
    const override = transferWeights[t.id];
    const w = typeof override === 'number' ? override : share;
    const amount = Number(t.amount) || 0;
    balance += (t.type === 'income' ? amount : -amount) * w;
  }
  return balance;
}

/** Pesos por id, listos para buildPeriodIndex. */
export function buildIndexWeights(accounts: Account[], savings: Saving[], transactions?: Transaction[]): IndexWeights {
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
  return {
    accounts: accountWeights,
    savings: savingWeights,
    transactions: transactions ? buildTransferWeights(transactions, accountList) : undefined,
  };
}

/** true si algo tiene titularidad parcial: si no, no hace falta ni ponderar ni ensenar el selector. */
export function hasSharedEntities(accounts: Account[], savings: Saving[]): boolean {
  const accountList = Array.isArray(accounts) ? accounts : [];
  const savingList = Array.isArray(savings) ? savings : [];
  for (let i = 0; i < accountList.length; i++) if (isShared(accountList[i])) return true;
  for (let i = 0; i < savingList.length; i++) if (isShared(savingList[i])) return true;
  return false;
}
