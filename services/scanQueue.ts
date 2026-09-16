import type { Transaction } from '../types';
import type { ScannedTransaction } from './geminiService';

// La cola de Aura Vision, fuera del componente.
//
// Antes era una cola FIFO destructiva: el item actual era siempre el primero y
// confirmar hacia slice(1). Eso obligaba a procesar los movimientos en el orden
// en que Aura los leyo, y ese orden casi nunca es el util: si los Bizums de una
// cena llegaron antes que el cargo total, no habia forma de crear primero el
// cargo, generar la deuda y volver a los Bizums para enlazarlos.
//
// Aqui la lista tiene longitud fija durante toda la sesion y lo unico que cambia
// es el estado de cada hueco. Los indices no se mueven, asi que navegar es
// cambiar un cursor y nada mas.
//
// Ademas el borrador del formulario vive DENTRO de cada hueco. No hay estado
// duplicado que sincronizar al ir y venir, y por tanto no hay forma de perder
// una edicion ni de arrastrar a un movimiento la deuda o la hucha del anterior,
// que es lo que pasaba cuando el formulario eran quince useState sueltos.
//
// Es puro: ni React, ni red, ni new Date(). La fecha de hoy entra como parametro.

export type ScanStatus = 'pending' | 'confirmed' | 'discarded';

/** El formulario entero, en un solo objeto. */
export interface ScanDraft {
  desc: string;
  amount: number | '';
  /** 'YYYY-MM-DD' */
  date: string;
  type: 'income' | 'expense' | 'saving';
  category: string;
  accountId: string;
  isRefundLink: boolean;
  selectedRefundId: string;
  selectedSavingId: string;
  myPartManual: number | '';
  isTransfer: boolean;
  transferTargetId: string;
  savingDirection: 'deposit' | 'withdraw';
  /**
   * Recordatorio que este movimiento cierra, si el usuario lo enlaza. Vive en el
   * borrador para que en Aura Vision la eleccion sobreviva a ir y volver entre
   * pendientes, como todo lo demas.
   */
  reminderId?: string;
}

export interface ScanSlot {
  /** Estable durante toda la sesion: es el cursor y la key de React. */
  id: string;
  /** Lo que extrajo Aura. Nunca se muta. null en el alta manual y en la edicion. */
  source: ScannedTransaction | null;
  draft: ScanDraft;
  status: ScanStatus;
}

export interface DraftContext {
  accounts: { id: string; name: string }[];
  budgets: { category: string; type?: string }[];
  /** 'YYYY-MM-DD'. Parametro para que la cola no dependa del reloj del dispositivo. */
  today: string;
}

const DAY_MS = 86400000;
/** Mas alla de esto, una fecha futura es un anio mal leido y no una compra por venir. */
export const FUTURE_TOLERANCE_DAYS = 45;
/** Por debajo de esto la fecha es vieja de verdad y se le estampa el anio en curso. */
export const PAST_TOLERANCE_DAYS = 300;

const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

function toUtc(date: string): number | null {
  if (!isIsoDate(date)) return null;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day);
}

const withYear = (date: string, year: number): string => String(year) + date.slice(4);

/**
 * Arregla el anio de una fecha leida de una imagen.
 *
 * Antes se estampaba el anio en curso a lo bruto: un ticket de diciembre
 * escaneado en enero se convertia en diciembre de ESTE anio, once meses en el
 * futuro y en un mes que todavia no existe. Ahora una fecha que se va demasiado
 * al futuro retrocede un anio, que es lo que de verdad habia pasado.
 */
export function normalizeScanDate(date: string, today: string): string {
  const todayMs = toUtc(today);
  if (todayMs === null) return isIsoDate(date) ? date : today;
  if (!isIsoDate(date)) return today;

  const asRead = toUtc(date);
  if (asRead === null) return today;

  const diffDays = (asRead - todayMs) / DAY_MS;
  if (diffDays <= FUTURE_TOLERANCE_DAYS && diffDays >= -PAST_TOLERANCE_DAYS) return date;

  // Fuera de rango: se prueba con el anio en curso y, si eso la deja en el
  // futuro, con el anterior.
  const currentYear = Number(today.slice(0, 4));
  const stamped = withYear(date, currentYear);
  const stampedMs = toUtc(stamped);
  if (stampedMs === null) return today;
  if ((stampedMs - todayMs) / DAY_MS > FUTURE_TOLERANCE_DAYS) return withYear(date, currentYear - 1);
  return stamped;
}

/**
 * Empareja la cuenta que sugiere Aura con una del usuario. Devuelve null si no
 * hay nada parecido: inventarse una cuenta seria peor que dejar la de por defecto.
 */
export function matchAccount(
  suggested: string | undefined,
  accounts: { id: string; name: string }[],
): string | null {
  if (!suggested || !Array.isArray(accounts)) return null;
  const wanted = String(suggested).toLowerCase();
  if (!wanted) return null;
  const found = accounts.find(account => {
    const name = String(account.name || '').toLowerCase();
    if (!name) return false;
    // Revolut se reconoce por el fondo negro de la captura.
    if (wanted.indexOf('revolut') !== -1 && (name.indexOf('revolut') !== -1 || name.indexOf('rev') !== -1)) return true;
    // Banco principal, por el fondo blanco o verde.
    if (wanted.indexOf('principal') !== -1 && (name.indexOf('principal') !== -1 || name.indexOf('santander') !== -1 || name.indexOf('bbva') !== -1)) return true;
    return name.indexOf(wanted) !== -1 || wanted.indexOf(name) !== -1;
  });
  return found ? found.id : null;
}

/**
 * Traduce la categoria leida a una de los presupuestos. Si no encaja con
 * ninguna, se conserva TAL CUAL: sustituirla en silencio por la primera de la
 * lista esconde lo que Aura leyo de verdad.
 */
export function matchCategory(category: string, budgets: { category: string; type?: string }[]): string {
  const raw = String(category || '');
  if (!raw || !Array.isArray(budgets)) return raw;
  const wanted = raw.toLowerCase();
  const found = budgets.filter(b => b.type !== 'saving').find(b => {
    const name = String(b.category || '').toLowerCase();
    if (!name) return false;
    return name === wanted || wanted.indexOf(name) !== -1 || name.indexOf(wanted) !== -1;
  });
  return found ? found.category : raw;
}

export function emptyDraft(ctx: DraftContext): ScanDraft {
  return {
    desc: '',
    amount: '',
    date: ctx.today,
    type: 'expense',
    category: '',
    accountId: ctx.accounts[0] ? ctx.accounts[0].id : '',
    isRefundLink: false,
    selectedRefundId: '',
    selectedSavingId: '',
    myPartManual: '',
    isTransfer: false,
    transferTargetId: '',
    savingDirection: 'deposit',
    reminderId: undefined,
  };
}

/** El borrador de un movimiento extraido. Completo: no hereda nada del anterior. */
export function draftFromScan(item: ScannedTransaction, ctx: DraftContext): ScanDraft {
  const base = emptyDraft(ctx);
  const matchedAccount = matchAccount(item.suggestedAccount, ctx.accounts);
  return {
    ...base,
    desc: item.description || '',
    amount: Number(item.amount) || 0,
    date: normalizeScanDate(item.date, ctx.today),
    type: item.isSaving ? 'saving' : (item.type === 'income' ? 'income' : 'expense'),
    category: matchCategory(item.category, ctx.budgets),
    accountId: matchedAccount || base.accountId,
    isRefundLink: !!item.isRefund,
    isTransfer: !!item.isTransfer,
    savingDirection: item.isSaving && item.type === 'income' ? 'withdraw' : 'deposit',
  };
}

/** El borrador de un movimiento que ya existe, para editarlo. */
export function draftFromTx(tx: Transaction, ctx: DraftContext): ScanDraft {
  const base = emptyDraft(ctx);
  const isSaving = tx.category === 'Ahorro' || !!tx.savingId;
  return {
    ...base,
    desc: tx.description || '',
    amount: Number(tx.amount) || 0,
    date: tx.date,
    type: isSaving ? 'saving' : tx.type,
    category: tx.category,
    accountId: tx.accountId,
    isRefundLink: !!tx.isRefund || !!tx.refundId,
    selectedRefundId: tx.refundId || '',
    selectedSavingId: tx.savingId || '',
    savingDirection: isSaving && tx.type === 'income' ? 'withdraw' : 'deposit',
  };
}

export function buildSlots(items: ScannedTransaction[] | null | undefined, ctx: DraftContext): ScanSlot[] {
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => ({
    id: 'scan_' + index,
    source: item,
    draft: draftFromScan(item, ctx),
    status: 'pending' as ScanStatus,
  }));
}

/** Un unico hueco, para el alta manual y la edicion: el mismo camino que la cola. */
export function singleSlot(draft: ScanDraft): ScanSlot[] {
  return [{ id: 'single', source: null, draft, status: 'pending' }];
}

export function updateDraft(slots: ScanSlot[], id: string, patch: Partial<ScanDraft>): ScanSlot[] {
  return slots.map(slot => (slot.id === id ? { ...slot, draft: { ...slot.draft, ...patch } } : slot));
}

export function markStatus(slots: ScanSlot[], id: string, status: ScanStatus): ScanSlot[] {
  return slots.map(slot => (slot.id === id ? { ...slot, status } : slot));
}

export function findSlot(slots: ScanSlot[], id: string): ScanSlot | null {
  const found = slots.find(slot => slot.id === id);
  return found || null;
}

/** El siguiente pendiente dando la vuelta. null si no queda ninguno mas. */
export function nextPendingId(slots: ScanSlot[], fromId: string, step: number = 1): string | null {
  const pending = slots.filter(slot => slot.status === 'pending');
  if (!pending.length) return null;
  if (pending.length === 1) return pending[0].id === fromId ? null : pending[0].id;

  const position = pending.findIndex(slot => slot.id === fromId);
  if (position === -1) return pending[0].id;
  const size = pending.length;
  const target = ((position + step) % size + size) % size;
  return pending[target].id;
}

export const prevPendingId = (slots: ScanSlot[], fromId: string): string | null => nextPendingId(slots, fromId, -1);

export function countByStatus(slots: ScanSlot[]): { pending: number; confirmed: number; discarded: number; total: number } {
  let pending = 0;
  let confirmed = 0;
  let discarded = 0;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].status === 'pending') pending++;
    else if (slots[i].status === 'confirmed') confirmed++;
    else discarded++;
  }
  return { pending, confirmed, discarded, total: slots.length };
}

export type TxPayload = Omit<Transaction, 'id'>;

export type DraftPayload =
  | { kind: 'single'; tx: TxPayload; myPart?: number }
  | { kind: 'transfer'; out: TxPayload; in: TxPayload };

/**
 * Lo que se va a escribir, exactamente igual que antes de existir este modulo.
 *
 * Vive fuera del componente para poder afirmarlo en un test: esta es la unica
 * pieza de la app que decide que movimiento se crea, y por tanto la unica que no
 * puede equivocarse.
 */
export function payloadFromDraft(draft: ScanDraft, accountName: (id: string) => string): DraftPayload | null {
  if (draft.amount === '') return null;
  const amount = Number(draft.amount);

  if (draft.isTransfer) {
    return {
      kind: 'transfer',
      out: {
        date: draft.date,
        amount,
        description: 'Transferencia a ' + (accountName(draft.transferTargetId) || 'Cuenta'),
        category: 'Traspaso',
        type: 'expense',
        accountId: draft.accountId,
        isRefund: false,
      },
      in: {
        date: draft.date,
        amount,
        description: 'Transferencia desde ' + (accountName(draft.accountId) || 'Cuenta'),
        category: 'Traspaso',
        type: 'income',
        accountId: draft.transferTargetId,
        isRefund: false,
      },
    };
  }

  const finalType = draft.type === 'saving'
    ? (draft.savingDirection === 'deposit' ? 'expense' : 'income')
    : draft.type;
  const finalCategory = draft.type === 'saving' ? 'Ahorro' : draft.category;

  const tx: TxPayload = {
    date: draft.date,
    amount,
    description: draft.desc,
    category: finalCategory,
    type: finalType as Transaction['type'],
    accountId: draft.accountId,
    isRefund: draft.isRefundLink,
    refundId: (finalType === 'income' && draft.isRefundLink) ? draft.selectedRefundId : undefined,
    savingId: draft.type === 'saving' ? draft.selectedSavingId : undefined,
  };

  // Tu parte solo tiene sentido en el gasto que genera la deuda.
  const myPart = finalType === 'expense' && draft.isRefundLink
    ? (draft.myPartManual === '' ? amount / 2 : Number(draft.myPartManual))
    : undefined;

  return { kind: 'single', tx, myPart };
}
