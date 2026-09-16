import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useFinance } from '../App';
import {
  X,
  UserCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Ban,
  ArrowDownCircle,
  ArrowUpCircle,
} from 'lucide-react';
import { Transaction } from '../types';
import type { ScannedTransaction } from '../services/geminiService';
import {
  buildSlots,
  singleSlot,
  emptyDraft,
  draftFromTx,
  updateDraft,
  markStatus,
  findSlot,
  nextPendingId,
  prevPendingId,
  countByStatus,
  payloadFromDraft,
} from '../services/scanQueue';
import type { ScanDraft, ScanSlot } from '../services/scanQueue';
import { suggestRemindersForDraft } from '../services/expenseReminders';

// Formulario de movimiento: alta manual, edicion y confirmacion de lo que
// extrae Aura Vision. Vive aparte para poder abrirse sobre cualquier pantalla
// (el boton flotante ya no obliga a ir a Transacciones).
//
// Los tres casos recorren el mismo camino: una lista de huecos con su borrador
// dentro. El alta manual y la edicion son una lista de uno; Aura Vision, una de
// tantos como haya leido. Como el borrador vive en el hueco, moverse entre
// movimientos es cambiar un cursor: no hay estado que sincronizar, no se pierde
// lo editado y ningun movimiento hereda la deuda o la hucha del anterior.
//
// Lo unico que escribe es handleSubmit, y solo cuando el usuario confirma. La
// logica de QUE se escribe vive en services/scanQueue.ts, cubierta por tests.

interface TransactionModalProps {
  /** Movimiento a editar. null para uno nuevo. */
  editingTx: Transaction | null;
  /**
   * Lo que ha leido Aura Vision. Quien la pasa ya ha abierto el lote de
   * deshacer (startUndoBatch); el modal lo cierra al acabar.
   */
  scannedItems: ScannedTransaction[] | null;
  onClose: () => void;
}

const todayKey = () => {
  const now = new Date();
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
};

const TransactionModal: React.FC<TransactionModalProps> = ({ editingTx: initialTx, scannedItems, onClose }) => {
  const {
    accounts, savings, refunds, budgets, expenseReminders,
    addTransaction, updateTransaction, markReminderDone, startUndoBatch, commitUndoBatch,
  } = useFinance();

  const [editingTx] = useState<Transaction | null>(initialTx);
  const isInScanBatch = useRef(!!(scannedItems && scannedItems.length));
  const [isScanSession] = useState(!!(scannedItems && scannedItems.length) && !initialTx);

  // El contexto de carga se congela al abrir: si cambiasen las cuentas a mitad
  // de sesion, los borradores ya creados no deben moverse solos.
  const [loadContext] = useState(() => ({
    accounts: accounts.map(a => ({ id: a.id, name: a.name })),
    budgets: budgets.map(b => ({ category: b.category, type: b.type })),
    today: todayKey(),
  }));

  const [slots, setSlots] = useState<ScanSlot[]>(() => {
    if (initialTx) return singleSlot(draftFromTx(initialTx, loadContext));
    if (scannedItems && scannedItems.length) return buildSlots(scannedItems, loadContext);
    return singleSlot(emptyDraft(loadContext));
  });
  const [cursor, setCursor] = useState<string>(() => (scannedItems && scannedItems.length && !initialTx ? 'scan_0' : 'single'));
  const [confirmingClose, setConfirmingClose] = useState(false);

  const current = findSlot(slots, cursor);
  const draft: ScanDraft = current ? current.draft : emptyDraft(loadContext);
  const counts = countByStatus(slots);
  const cursorIndex = slots.findIndex(slot => slot.id === cursor);

  const patch = (changes: Partial<ScanDraft>) => setSlots(prev => updateDraft(prev, cursor, changes));

  // Lógica de Categorías Disponibles Refinada
  const availableCategories = useMemo(() => {
    if (draft.type === 'saving') return ['Ahorro'];

    if (draft.type === 'income' && draft.isRefundLink && draft.selectedRefundId) {
      const selectedRefund = refunds.find(r => r.id === draft.selectedRefundId);
      if (selectedRefund) return [selectedRefund.category];
    }

    if (draft.type === 'income' && draft.isRefundLink) {
      const expenseCats = budgets.filter(b => b.type === 'expense').map(b => b.category);
      return expenseCats.length > 0 ? Array.from(new Set(expenseCats)) : ['Sin Presupuesto de Gasto'];
    }

    const budgetList = budgets
      .filter(b => b.type === (draft.type as any === 'saving' ? 'expense' : draft.type as any))
      .map(b => b.category);
    const uniqueCategories = Array.from(new Set(budgetList));
    return uniqueCategories.length > 0 ? uniqueCategories : ['Sin Presupuesto'];
  }, [draft.type, draft.isRefundLink, draft.selectedRefundId, budgets, refunds]);

  // Si Aura lee "Gasolina" y no hay presupuesto con ese nombre, se conserva lo
  // leido y se anade a la lista. Antes lo sustituia la primera categoria
  // alfabetica sin decir nada, y lo que Aura habia visto de verdad se perdia.
  const categoryOptions = useMemo(() => {
    if (draft.category && availableCategories.indexOf(draft.category) === -1) {
      return availableCategories.concat([draft.category]);
    }
    return availableCategories;
  }, [availableCategories, draft.category]);

  useEffect(() => {
    if (draft.type === 'income' && draft.isRefundLink && draft.selectedRefundId) {
      const refundObj = refunds.find(r => r.id === draft.selectedRefundId);
      if (refundObj && draft.category !== refundObj.category) patch({ category: refundObj.category });
    } else if (!draft.category) {
      // Solo se rellena cuando esta vacia. Cambiar de tipo la vacia a proposito,
      // que es una decision del usuario y no una sustitucion a sus espaldas.
      patch({ category: availableCategories[0] || '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableCategories, draft.type, draft.isRefundLink, draft.selectedRefundId, draft.category]);

  // Recordatorios que este gasto podria estar cerrando. Solo se ofrecen: nada
  // viene preseleccionado, y no enlazar nada es el comportamiento por defecto.
  const reminderSuggestions = useMemo(() => {
    if (editingTx || draft.isTransfer || draft.type !== 'expense' || draft.amount === '') return [];
    return suggestRemindersForDraft(expenseReminders, {
      amount: Number(draft.amount),
      date: draft.date,
      category: draft.category,
      description: draft.desc,
    }, loadContext.today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseReminders, editingTx, draft.isTransfer, draft.type, draft.amount, draft.date, draft.category, draft.desc]);

  const linkedReminder = draft.reminderId
    ? reminderSuggestions.find(s => s.reminder.id === draft.reminderId)
    : undefined;

  const finishScanBatch = () => {
    if (isInScanBatch.current) {
      commitUndoBatch('Aura Vision');
      isInScanBatch.current = false;
    }
  };

  // Si el modal desaparece sin pasar por close(), el lote se quedaria abierto y
  // todas las altas posteriores se acumularian en un grupo que nadie confirma,
  // dejando mudo el boton de deshacer.
  useEffect(() => () => { finishScanBatch(); }, []);

  const close = () => {
    finishScanBatch();
    onClose();
  };

  /** Cerrar dejando pendientes sin guardar pide un segundo toque. */
  const requestClose = () => {
    if (isScanSession && counts.pending > 0 && !confirmingClose) {
      setConfirmingClose(true);
      window.setTimeout(() => setConfirmingClose(false), 4000);
      return;
    }
    close();
  };

  /** Deja el hueco marcado y salta al siguiente pendiente. Cierra si no queda ninguno. */
  const advanceFrom = (id: string, status: 'confirmed' | 'discarded') => {
    const marked = markStatus(slots, id, status);
    setSlots(marked);
    const siguiente = nextPendingId(marked, id);
    if (siguiente) {
      setCursor(siguiente);
      setConfirmingClose(false);
    } else {
      close();
    }
  };

  const goTo = (id: string) => {
    setCursor(id);
    setConfirmingClose(false);
  };

  const accountName = (id: string) => {
    const found = accounts.find(a => a.id === id);
    return found ? found.name : '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Guardia contra el alta doble: con navegacion libre se puede volver a un
    // hueco ya resuelto, y confirmarlo otra vez crearia el movimiento dos veces.
    if (!current || current.status !== 'pending') return;

    const payload = payloadFromDraft(draft, accountName);
    if (!payload) return;

    if (payload.kind === 'transfer') {
      // Dentro de una sesion de Aura el lote exterior ya agrupa todo: abrir otro
      // aqui lo cerraria a medias y el resto de altas se quedarian sueltas.
      if (!isInScanBatch.current) startUndoBatch();
      addTransaction(payload.out);
      addTransaction(payload.in);
      if (!isInScanBatch.current) {
        commitUndoBatch(`Traspaso: ${Number(draft.amount).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
      }
    } else if (editingTx) {
      updateTransaction({
        ...editingTx,
        date: payload.tx.date,
        amount: payload.tx.amount,
        description: payload.tx.description,
        category: payload.tx.category,
        type: payload.tx.type,
        accountId: payload.tx.accountId,
        refundId: payload.tx.refundId,
        savingId: payload.tx.savingId,
      });
    } else {
      const nuevoId = addTransaction(payload.tx, payload.myPart);
      // El movimiento se crea EXACTAMENTE igual que antes, sin campos nuevos. Lo
      // unico que se anade es una marca dentro del recordatorio, que es otra
      // coleccion: el historial no se toca.
      if (draft.reminderId && linkedReminder) {
        markReminderDone(draft.reminderId, linkedReminder.month, {
          txId: nuevoId,
          amount: payload.tx.amount,
          at: loadContext.today,
        });
      }
    }

    if (isScanSession) {
      advanceFrom(current.id, 'confirmed');
    } else {
      close();
    }
  };

  const handleDiscardCurrent = () => {
    if (!current) return;
    advanceFrom(current.id, 'discarded');
  };

  const isCategoryDisabled = draft.type === 'income' && draft.isRefundLink && !!draft.selectedRefundId;
  const amountLocked = isScanSession && !editingTx;
  const canNavigate = isScanSession && counts.pending > 1;
  const euros = (value: number | '') => (value === '' ? '—' : Number(value).toLocaleString('es-ES') + '€');

  return (
     <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4">
         <div className="bg-white dark:bg-slate-900 rounded-[3rem] w-full max-w-lg p-10 shadow-2xl animate-in zoom-in duration-300 border border-slate-200 dark:border-slate-800 overflow-y-auto max-h-[90vh] custom-scrollbar">
            <div className="flex justify-between items-center mb-6">
              <div className="flex flex-col">
                <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                  {editingTx ? 'Editar Movimiento' : isScanSession ? 'Aura Vision: Confirmación' : 'Nuevo Movimiento'}
                </h3>
                {isScanSession && (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Sparkles size={14} className="text-blue-500 animate-pulse" />
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                      {cursorIndex + 1} de {counts.total} analizados
                    </span>
                    {counts.confirmed > 0 && (
                      <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-lg uppercase tracking-widest">
                        ✓ {counts.confirmed} guardados
                      </span>
                    )}
                  </div>
                )}
              </div>
              <button onClick={requestClose} className="p-4 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400"><X size={28} /></button>
            </div>

            {/* Tira de pendientes. Se puede ir y volver entre las que quedan: es lo
                que permite crear primero el cargo total, generar la deuda y volver
                despues a los Bizums anteriores para enlazarlos. */}
            {canNavigate && (
              <div className="flex items-center gap-2 mb-8">
                <button
                  type="button"
                  onClick={() => { const id = prevPendingId(slots, cursor); if (id) goTo(id); }}
                  aria-label="Movimiento anterior"
                  className="w-11 h-11 shrink-0 flex items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  <ChevronLeft size={20} />
                </button>
                <div className="flex-1 min-w-0 flex gap-2 overflow-x-auto custom-scrollbar snap-x py-1">
                  {slots.map((slot, index) => {
                    if (slot.status !== 'pending') return null;
                    const active = slot.id === cursor;
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        onClick={() => goTo(slot.id)}
                        aria-current={active ? 'true' : undefined}
                        className={`shrink-0 snap-start px-3 py-1.5 rounded-xl border-2 transition-all text-left ${
                          active
                            ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-blue-300'
                        }`}
                      >
                        <span className="block text-[9px] font-black uppercase tracking-widest opacity-70">#{index + 1}</span>
                        <span className="block text-[11px] font-black whitespace-nowrap">{euros(slot.draft.amount)}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => { const id = nextPendingId(slots, cursor); if (id) goTo(id); }}
                  aria-label="Movimiento siguiente"
                  className="w-11 h-11 shrink-0 flex items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="flex bg-slate-100 dark:bg-slate-800 p-2 rounded-[1.8rem] border border-slate-200 dark:border-slate-700 shadow-inner">
                <button type="button" onClick={() => patch({ type: 'expense', isTransfer: false, category: '' })} className={`flex-1 py-4 text-[12px] font-black rounded-2xl transition-all ${draft.type === 'expense' && !draft.isTransfer ? 'bg-white dark:bg-slate-700 shadow-md text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-500'}`}>GASTO</button>
                <button type="button" onClick={() => patch({ type: 'income', isTransfer: false, category: '' })} className={`flex-1 py-4 text-[12px] font-black rounded-2xl transition-all ${draft.type === 'income' && !draft.isTransfer ? 'bg-white dark:bg-slate-700 shadow-md text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-500'}`}>INGRESO</button>
                <button type="button" onClick={() => patch({ type: 'saving', isTransfer: false, category: '' })} className={`flex-1 py-4 text-[12px] font-black rounded-2xl transition-all ${draft.type === 'saving' ? 'bg-white dark:bg-slate-700 shadow-md text-amber-500 dark:text-amber-400' : 'text-slate-500 dark:text-slate-500'}`}>AHORRO</button>
                <button type="button" onClick={() => patch({ isTransfer: true, type: 'expense', category: '' })} className={`flex-1 py-4 text-[12px] font-black rounded-2xl transition-all ${draft.isTransfer ? 'bg-white dark:bg-slate-700 shadow-md text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-500'}`}>TRASPASO</button>
              </div>

              {draft.type === 'saving' && (
                <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-2xl border-2 border-amber-100 dark:border-amber-800 flex items-center gap-4 animate-in slide-in-from-top-2">
                    <div className="flex-1">
                        <label className="block text-[11px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-widest mb-2">Dirección del ahorro</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => patch({ savingDirection: 'deposit' })}
                                className={`flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black transition-all ${draft.savingDirection === 'deposit' ? 'bg-amber-500 text-white shadow-lg' : 'bg-white dark:bg-slate-800 text-amber-500 border border-amber-200'}`}
                            >
                                <ArrowUpCircle size={14} /> APORTACIÓN
                            </button>
                            <button
                                type="button"
                                onClick={() => patch({ savingDirection: 'withdraw' })}
                                className={`flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black transition-all ${draft.savingDirection === 'withdraw' ? 'bg-amber-600 text-white shadow-lg' : 'bg-white dark:bg-slate-800 text-amber-600 border border-amber-200'}`}
                            >
                                <ArrowDownCircle size={14} /> RETIRADA
                            </button>
                        </div>
                    </div>
                </div>
              )}

              <div className="space-y-6">
                <div>
                  <label className="block text-[11px] font-black text-slate-700 dark:text-slate-400 uppercase tracking-widest mb-3">Descripción</label>
                  <input type="text" value={draft.desc} onChange={e => patch({ desc: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-bold outline-none focus:border-blue-400 dark:focus:border-blue-600 transition-all placeholder:text-slate-300 dark:placeholder:text-slate-600 text-slate-900 dark:text-white" placeholder="Ej: Supermercado..." required />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="relative">
                    <label className="block text-[11px] font-black text-slate-700 dark:text-slate-400 uppercase tracking-widest mb-3">Importe (€)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={draft.amount}
                      onChange={e => patch({ amount: e.target.value === '' ? '' : Number(e.target.value) })}
                      disabled={amountLocked}
                      className={`w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-black text-xl outline-none text-slate-900 dark:text-white ${amountLocked ? 'opacity-60 grayscale cursor-not-allowed' : ''}`}
                      required
                    />
                    {amountLocked && (
                      <div className="absolute top-10 right-4 text-blue-500 flex items-center gap-1">
                        <Ban size={14} />
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-[11px] font-black text-slate-700 dark:text-slate-400 uppercase tracking-widest mb-3">Fecha</label>
                    <input type="date" value={draft.date} onChange={e => patch({ date: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-bold outline-none text-slate-900 dark:text-white" required />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[11px] font-black text-slate-700 dark:text-slate-400 uppercase tracking-widest mb-3">
                      {draft.isTransfer ? 'Cuenta Origen' : draft.savingDirection === 'withdraw' ? 'Cuenta Destino' : 'Desde Cuenta'}
                    </label>
                    <div className="relative">
                      <select value={draft.accountId} onChange={e => patch({ accountId: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-bold outline-none appearance-none text-slate-900 dark:text-white">
                        {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                      </select>
                      <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-black text-slate-700 dark:text-slate-400 uppercase tracking-widest mb-3">
                      {draft.isTransfer ? 'Cuenta Destino' : draft.type === 'saving' ? 'Hucha' : 'Categoría'}
                    </label>
                    <div className="relative">
                      {draft.isTransfer ? (
                        <select value={draft.transferTargetId} onChange={e => patch({ transferTargetId: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-bold outline-none appearance-none text-slate-900 dark:text-white" required>
                          <option value="">Selecciona destino</option>
                          {accounts.filter(a => a.id !== draft.accountId).map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                        </select>
                      ) : draft.type === 'saving' ? (
                        <select value={draft.selectedSavingId} onChange={e => patch({ selectedSavingId: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-bold outline-none appearance-none text-slate-900 dark:text-white" required>
                          <option value="">Selecciona hucha</option>
                          {savings.map(s => <option key={s.id} value={s.id}>{s.emoji} {s.name}</option>)}
                        </select>
                      ) : (
                        <select
                          value={draft.category}
                          onChange={e => patch({ category: e.target.value })}
                          disabled={isCategoryDisabled}
                          className={`w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-bold outline-none appearance-none text-slate-900 dark:text-white ${isCategoryDisabled ? 'opacity-60 cursor-not-allowed bg-slate-100 dark:bg-slate-900' : ''}`}
                          required
                        >
                          {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      )}
                      <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
                    </div>
                  </div>
                </div>

                {!draft.isTransfer && draft.type !== 'saving' && (
                  <div className="pt-4">
                     <button
                       type="button"
                       onClick={() => patch({ isRefundLink: !draft.isRefundLink, category: draft.type === 'income' ? '' : draft.category })}
                       className={`w-full flex items-center justify-between p-5 rounded-2xl border-2 transition-all ${draft.isRefundLink ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-400' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-400 dark:text-slate-600'}`}
                     >
                       <div className="flex items-center gap-3">
                         <UserCheck size={20} />
                         <span className="font-bold text-sm">Gestionar como Reembolso / Deuda</span>
                       </div>
                       <Check size={20} className={draft.isRefundLink ? 'text-blue-600 dark:text-blue-400 opacity-100' : 'opacity-0'} />
                     </button>

                     {draft.isRefundLink && (
                       <div className="mt-4 p-5 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border-2 border-blue-100 dark:border-blue-800 space-y-4 animate-in slide-in-from-top-2 duration-300">
                         {draft.type === 'expense' ? (
                           <>
                             <label className="block text-[11px] font-black text-blue-700 dark:text-blue-400 uppercase">Tu Parte (Gasto Neto)</label>
                             <input type="number" step="0.01" value={draft.myPartManual} onChange={e => patch({ myPartManual: e.target.value === '' ? '' : Number(e.target.value) })} className="w-full bg-white dark:bg-slate-800 border-2 border-blue-200 dark:border-blue-700 rounded-xl p-4 font-black outline-none text-center text-slate-900 dark:text-white" placeholder="Cuanto pagas tú" />
                           </>
                         ) : (
                           <>
                             <label className="block text-[11px] font-black text-blue-700 dark:text-blue-400 uppercase">Vincular a Deuda</label>
                             <select value={draft.selectedRefundId} onChange={e => patch({ selectedRefundId: e.target.value })} className="w-full bg-white dark:bg-slate-800 border-2 border-blue-200 dark:border-blue-700 rounded-xl p-4 font-bold outline-none text-slate-900 dark:text-white" required>
                               <option value="">Selecciona deuda pendiente</option>
                               {refunds.filter(r => r.status === 'open').map(r => <option key={r.id} value={r.id}>{r.name} ({r.pendingAmount}€)</option>)}
                             </select>
                           </>
                         )}
                       </div>
                     )}
                  </div>
                )}
              </div>

              {reminderSuggestions.length > 0 && (
                <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-2xl border-2 border-amber-100 dark:border-amber-800 animate-in slide-in-from-top-2">
                  {linkedReminder ? (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300 leading-relaxed min-w-0">
                        Se marcará como pagado: {linkedReminder.reminder.emoji || '🔔'} {linkedReminder.reminder.name}
                      </p>
                      <button
                        type="button"
                        onClick={() => patch({ reminderId: undefined })}
                        className="text-[10px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-widest shrink-0 hover:underline"
                      >
                        Quitar
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300 leading-relaxed mb-3">
                        ¿Esto es {reminderSuggestions[0].reminder.emoji || '🔔'} <strong>{reminderSuggestions[0].reminder.name}</strong>
                        {reminderSuggestions[0].reminder.amount !== undefined && ` (${reminderSuggestions[0].reminder.amount.toLocaleString('es-ES')}€)`}?
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => patch({ reminderId: reminderSuggestions[0].reminder.id })}
                          className="px-4 py-2 rounded-xl bg-amber-500 text-white text-[10px] font-black uppercase tracking-widest"
                        >
                          Sí, enlazar
                        </button>
                        {reminderSuggestions.slice(1).map(s => (
                          <button
                            key={s.reminder.id}
                            type="button"
                            onClick={() => patch({ reminderId: s.reminder.id })}
                            className="px-4 py-2 rounded-xl bg-white dark:bg-slate-800 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 text-[10px] font-black uppercase tracking-widest"
                          >
                            {s.reminder.name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3 pt-6">
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={requestClose}
                    className={`flex-1 py-5 font-black rounded-2xl transition-colors ${confirmingClose ? 'bg-amber-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400'}`}
                  >
                    {confirmingClose
                      ? `¿SEGURO? QUEDAN ${counts.pending} SIN GUARDAR`
                      : isScanSession ? 'TERMINAR' : 'CANCELAR'}
                  </button>

                  {isScanSession && (
                    <button
                      type="button"
                      onClick={handleDiscardCurrent}
                      className="flex-1 py-5 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 font-black rounded-2xl border-2 border-rose-100 dark:border-rose-900/50 transition-all hover:bg-rose-100"
                    >
                      DESCARTAR
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={!!current && current.status !== 'pending'}
                  className="w-full py-5 bg-blue-600 text-white font-black rounded-2xl shadow-xl shadow-blue-100 dark:shadow-none transition-all active:scale-95 disabled:opacity-50"
                >
                  {editingTx ? 'GUARDAR' : counts.pending > 1 ? 'CONFIRMAR Y SIGUIENTE' : isScanSession ? 'CONFIRMAR Y TERMINAR' : 'CONFIRMAR'}
                </button>
              </div>
            </form>
         </div>
     </div>
  );
};

export default TransactionModal;
