import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useFinance } from '../App';
import {
  X,
  UserCheck,
  Check,
  ChevronDown,
  Sparkles,
  Ban,
  ArrowDownCircle,
  ArrowUpCircle,
} from 'lucide-react';
import { Transaction } from '../types';
import type { ScannedTransaction } from '../services/geminiService';

// Formulario de movimiento: alta manual, edicion y confirmacion de lo que
// extrae Aura Vision. Vive aparte para poder abrirse sobre cualquier pantalla
// (el boton flotante ya no obliga a ir a Transacciones).
//
// La logica de guardado es la misma que tenia Transactions.tsx, sin cambios:
// solo se crea o edita un movimiento cuando el usuario confirma el formulario.

interface TransactionModalProps {
  /** Movimiento a editar. null para uno nuevo. */
  editingTx: Transaction | null;
  /**
   * Cola de Aura Vision, ya en el orden en que se confirma. Quien la pasa ya ha
   * abierto el lote de deshacer (startUndoBatch); el modal lo cierra al acabar.
   */
  scannedItems: ScannedTransaction[] | null;
  onClose: () => void;
}

const TransactionModal: React.FC<TransactionModalProps> = ({ editingTx: initialTx, scannedItems, onClose }) => {
  const { accounts, savings, refunds, budgets, addTransaction, updateTransaction, startUndoBatch, commitUndoBatch } = useFinance();

  const [editingTx] = useState<Transaction | null>(initialTx);
  const isInScanBatch = useRef(!!(scannedItems && scannedItems.length));
  const [scannedQueue, setScannedQueue] = useState<ScannedTransaction[]>(scannedItems || []);
  const [totalScannedCount] = useState(scannedItems ? scannedItems.length : 0);

  // Form states
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [type, setType] = useState<'income' | 'expense' | 'saving'>('expense');
  const [category, setCategory] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id || '');
  const [isRefundLink, setIsRefundLink] = useState(false);
  const [selectedRefundId, setSelectedRefundId] = useState('');
  const [selectedSavingId, setSelectedSavingId] = useState('');
  const [myPartManual, setMyPartManual] = useState<number | ''>('');

  // Extra states for Transfer
  const [isTransfer, setIsTransfer] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState('');

  // Nuevo: Dirección del flujo de ahorro (Aportación vs Retirada)
  const [savingDirection, setSavingDirection] = useState<'deposit' | 'withdraw'>('deposit');

  // Lógica de Categorías Disponibles Refinada
  const availableCategories = useMemo(() => {
    if (type === 'saving') return ["Ahorro"];

    if (type === 'income' && isRefundLink && selectedRefundId) {
      const selectedRefund = refunds.find(r => r.id === selectedRefundId);
      if (selectedRefund) return [selectedRefund.category];
    }

    if (type === 'income' && isRefundLink) {
      const expenseCats = budgets.filter(b => b.type === 'expense').map(b => b.category);
      return expenseCats.length > 0 ? Array.from(new Set(expenseCats)) : ["Sin Presupuesto de Gasto"];
    }

    const budgetList = budgets
      .filter(b => b.type === (type as any === 'saving' ? 'expense' : type as any))
      .map(b => b.category);
    const uniqueCategories = Array.from(new Set(budgetList));
    return uniqueCategories.length > 0 ? uniqueCategories : ["Sin Presupuesto"];
  }, [type, isRefundLink, selectedRefundId, budgets, refunds]);

  useEffect(() => {
    if (type === 'income' && isRefundLink && selectedRefundId) {
      const refundObj = refunds.find(r => r.id === selectedRefundId);
      if (refundObj) {
        setCategory(refundObj.category);
      }
    } else if (!availableCategories.includes(category)) {
      setCategory(availableCategories[0] || '');
    }
  }, [availableCategories, type, isRefundLink, selectedRefundId, refunds]);

  const loadTx = (tx: Transaction) => {
    setDesc(tx.description);
    setAmount(tx.amount);
    setDate(tx.date);
    const isSavingType = tx.category === 'Ahorro' || !!tx.savingId;
    setType(isSavingType ? 'saving' : tx.type);
    setCategory(tx.category);
    setAccountId(tx.accountId);
    setIsRefundLink(tx.isRefund || !!tx.refundId);
    setSelectedRefundId(tx.refundId || '');
    setSelectedSavingId(tx.savingId || '');

    // Si era ahorro, detectar la dirección original
    if (isSavingType) {
        setSavingDirection(tx.type === 'expense' ? 'deposit' : 'withdraw');
    }
  };

  const loadScannedItem = (item: ScannedTransaction) => {
    setDesc(item.description);
    setAmount(item.amount);

    // Validar año
    const currentYear = new Date().getFullYear().toString();
    let finalDate = item.date;
    if (item.date && !item.date.startsWith(currentYear)) {
      finalDate = currentYear + item.date.substring(4);
    }
    setDate(finalDate);

    if (item.isSaving) {
        setType('saving');
        setSavingDirection(item.type === 'expense' ? 'deposit' : 'withdraw');
    } else {
        setType(item.type);
    }

    setIsTransfer(item.isTransfer);
    setIsRefundLink(item.isRefund);

    // Mapeo inteligente de categorías para que coincidan con los Presupuestos.
    // Los objetivos de ahorro llevan el nombre de una hucha, no una categoria.
    const matchingBudget = budgets.filter(b => b.type !== 'saving').find(b =>
      b.category.toLowerCase() === item.category.toLowerCase() ||
      item.category.toLowerCase().includes(b.category.toLowerCase()) ||
      b.category.toLowerCase().includes(item.category.toLowerCase())
    );

    if (matchingBudget) {
      setCategory(matchingBudget.category);
    } else {
      setCategory(item.category);
    }

    // LÓGICA DE IDENTIFICACIÓN DE CUENTA POR AURA
    if (item.suggestedAccount) {
      const accountName = item.suggestedAccount.toLowerCase();
      const matched = accounts.find(a => {
        const name = a.name.toLowerCase();
        // Caso Revolut (Fondo negro)
        if (accountName.includes('revolut') && (name.includes('revolut') || name.includes('rev'))) return true;
        // Caso Banco Principal (Fondo blanco/verde)
        if (accountName.includes('principal') && (name.includes('principal') || name.includes('santander') || name.includes('bbva'))) return true;
        // Match genérico
        return name.includes(accountName) || accountName.includes(name);
      });
      if (matched) setAccountId(matched.id);
    }
  };

  // Carga inicial: el movimiento a editar o el primero de la cola de Aura Vision.
  // Solo rellena el formulario; no escribe nada.
  useEffect(() => {
    if (initialTx) loadTx(initialTx);
    else if (scannedItems && scannedItems.length) loadScannedItem(scannedItems[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishScanBatch = () => {
    if (isInScanBatch.current) {
      commitUndoBatch('Aura Vision');
      isInScanBatch.current = false;
    }
  };

  const close = () => {
    finishScanBatch();
    setScannedQueue([]);
    onClose();
  };

  const handleDiscardCurrentScanned = () => {
    const nextQueue = scannedQueue.slice(1);
    setScannedQueue(nextQueue);
    if (nextQueue.length > 0) {
      loadScannedItem(nextQueue[0]);
    } else {
      // Si se descartó el último, commit del batch (puede estar vacío)
      close();
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount === '') return;

    if (isTransfer) {
      // Agrupar las 2 transacciones del traspaso en un solo undo
      startUndoBatch();
      addTransaction({
        date,
        amount: Number(amount),
        description: `Transferencia a ${accounts.find(a => a.id === transferTargetId)?.name || 'Cuenta'}`,
        category: 'Traspaso',
        type: 'expense',
        accountId,
        isRefund: false
      });
      addTransaction({
        date,
        amount: Number(amount),
        description: `Transferencia desde ${accounts.find(a => a.id === accountId)?.name || 'Cuenta'}`,
        category: 'Traspaso',
        type: 'income',
        accountId: transferTargetId,
        isRefund: false
      });
      commitUndoBatch(`Traspaso: ${Number(amount).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
    } else {
      const finalType = type === 'saving'
        ? (savingDirection === 'deposit' ? 'expense' : 'income')
        : type;

      const finalCategory = type === 'saving' ? 'Ahorro' : category;

      if (editingTx) {
        updateTransaction({
          ...editingTx,
          date,
          amount: Number(amount),
          description: desc,
          category: finalCategory,
          type: finalType as any,
          accountId,
          refundId: (finalType === 'income' && isRefundLink) ? selectedRefundId : undefined,
          savingId: type === 'saving' ? selectedSavingId : undefined
        });
      } else {
        addTransaction({
          date,
          amount: Number(amount),
          description: desc,
          category: finalCategory,
          type: finalType as any,
          accountId,
          isRefund: isRefundLink,
          refundId: (finalType === 'income' && isRefundLink) ? selectedRefundId : undefined,
          savingId: type === 'saving' ? selectedSavingId : undefined
        }, finalType === 'expense' && isRefundLink ? (myPartManual === '' ? Number(amount) / 2 : Number(myPartManual)) : undefined);
      }
    }

    const nextQueue = scannedQueue.slice(1);
    setScannedQueue(nextQueue);
    if (nextQueue.length > 0) {
      loadScannedItem(nextQueue[0]);
    } else {
      // Si estábamos en batch de Aura Vision, commit
      close();
    }
  };

  const isCategoryDisabled = type === 'income' && isRefundLink && !!selectedRefundId;

  return (
     <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4">
         <div className="bg-white dark:bg-slate-900 rounded-[3rem] w-full max-w-lg p-10 shadow-2xl animate-in zoom-in duration-300 border border-slate-200 dark:border-slate-800 overflow-y-auto max-h-[90vh] custom-scrollbar">
            <div className="flex justify-between items-center mb-10">
              <div className="flex flex-col">
                <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                  {editingTx ? 'Editar Movimiento' : scannedQueue.length > 0 ? 'Aura Vision: Confirmación' : 'Nuevo Movimiento'}
                </h3>
                {scannedQueue.length > 0 && (
                  <div className="flex items-center gap-2 mt-2">
                    <Sparkles size={14} className="text-blue-500 animate-pulse" />
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                      {totalScannedCount - scannedQueue.length + 1} de {totalScannedCount} analizados
                    </span>
                  </div>
                )}
              </div>
              <button onClick={close} className="p-4 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400"><X size={28} /></button>
            </div>

            <form onSubmit={handleManualSubmit} className="space-y-8">
              <div className="flex bg-slate-100 dark:bg-slate-800 p-2 rounded-[1.8rem] border border-slate-200 dark:border-slate-700 shadow-inner">
                <button type="button" onClick={() => {setType('expense'); setIsTransfer(false);}} className={`flex-1 py-4 text-[12px] font-black rounded-2xl transition-all ${type === 'expense' && !isTransfer ? 'bg-white dark:bg-slate-700 shadow-md text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-500'}`}>GASTO</button>
                <button type="button" onClick={() => {setType('income'); setIsTransfer(false);}} className={`flex-1 py-4 text-[12px] font-black rounded-2xl transition-all ${type === 'income' && !isTransfer ? 'bg-white dark:bg-slate-700 shadow-md text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-500'}`}>INGRESO</button>
                <button type="button" onClick={() => {setType('saving'); setIsTransfer(false);}} className={`flex-1 py-4 text-[12px] font-black rounded-2xl transition-all ${type === 'saving' ? 'bg-white dark:bg-slate-700 shadow-md text-amber-500 dark:text-amber-400' : 'text-slate-500 dark:text-slate-500'}`}>AHORRO</button>
                <button type="button" onClick={() => {setIsTransfer(true); setType('expense');}} className={`flex-1 py-4 text-[12px] font-black rounded-2xl transition-all ${isTransfer ? 'bg-white dark:bg-slate-700 shadow-md text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-500'}`}>TRASPASO</button>
              </div>

              {type === 'saving' && (
                <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-2xl border-2 border-amber-100 dark:border-amber-800 flex items-center gap-4 animate-in slide-in-from-top-2">
                    <div className="flex-1">
                        <label className="block text-[11px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-widest mb-2">Dirección del ahorro</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setSavingDirection('deposit')}
                                className={`flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black transition-all ${savingDirection === 'deposit' ? 'bg-amber-500 text-white shadow-lg' : 'bg-white dark:bg-slate-800 text-amber-500 border border-amber-200'}`}
                            >
                                <ArrowUpCircle size={14} /> APORTACIÓN
                            </button>
                            <button
                                type="button"
                                onClick={() => setSavingDirection('withdraw')}
                                className={`flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black transition-all ${savingDirection === 'withdraw' ? 'bg-amber-600 text-white shadow-lg' : 'bg-white dark:bg-slate-800 text-amber-600 border border-amber-200'}`}
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
                  <input type="text" value={desc} onChange={e => setDesc(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-bold outline-none focus:border-blue-400 dark:focus:border-blue-600 transition-all placeholder:text-slate-300 dark:placeholder:text-slate-600 text-slate-900 dark:text-white" placeholder="Ej: Supermercado..." required />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="relative">
                    <label className="block text-[11px] font-black text-slate-700 dark:text-slate-400 uppercase tracking-widest mb-3">Importe (€)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={amount}
                      onChange={e => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                      disabled={scannedQueue.length > 0 && !editingTx}
                      className={`w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-black text-xl outline-none text-slate-900 dark:text-white ${scannedQueue.length > 0 && !editingTx ? 'opacity-60 grayscale cursor-not-allowed' : ''}`}
                      required
                    />
                    {scannedQueue.length > 0 && !editingTx && (
                      <div className="absolute top-10 right-4 text-blue-500 flex items-center gap-1">
                        <Ban size={14} />
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-[11px] font-black text-slate-700 dark:text-slate-400 uppercase tracking-widest mb-3">Fecha</label>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-bold outline-none text-slate-900 dark:text-white" required />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[11px] font-black text-slate-700 dark:text-slate-400 uppercase tracking-widest mb-3">
                      {isTransfer ? 'Cuenta Origen' : savingDirection === 'withdraw' ? 'Cuenta Destino' : 'Desde Cuenta'}
                    </label>
                    <div className="relative">
                      <select value={accountId} onChange={e => setAccountId(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-bold outline-none appearance-none text-slate-900 dark:text-white">
                        {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                      </select>
                      <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-black text-slate-700 dark:text-slate-400 uppercase tracking-widest mb-3">
                      {isTransfer ? 'Cuenta Destino' : type === 'saving' ? 'Hucha' : 'Categoría'}
                    </label>
                    <div className="relative">
                      {isTransfer ? (
                        <select value={transferTargetId} onChange={e => setTransferTargetId(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-bold outline-none appearance-none text-slate-900 dark:text-white" required>
                          <option value="">Selecciona destino</option>
                          {accounts.filter(a => a.id !== accountId).map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                        </select>
                      ) : type === 'saving' ? (
                        <select value={selectedSavingId} onChange={e => setSelectedSavingId(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-bold outline-none appearance-none text-slate-900 dark:text-white" required>
                          <option value="">Selecciona hucha</option>
                          {savings.map(s => <option key={s.id} value={s.id}>{s.emoji} {s.name}</option>)}
                        </select>
                      ) : (
                        <select
                          value={category}
                          onChange={e => setCategory(e.target.value)}
                          disabled={isCategoryDisabled}
                          className={`w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-bold outline-none appearance-none text-slate-900 dark:text-white ${isCategoryDisabled ? 'opacity-60 cursor-not-allowed bg-slate-100 dark:bg-slate-900' : ''}`}
                          required
                        >
                          {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      )}
                      <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
                    </div>
                  </div>
                </div>

                {!isTransfer && type !== 'saving' && (
                  <div className="pt-4">
                     <button
                       type="button"
                       onClick={() => setIsRefundLink(!isRefundLink)}
                       className={`w-full flex items-center justify-between p-5 rounded-2xl border-2 transition-all ${isRefundLink ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-400' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-400 dark:text-slate-600'}`}
                     >
                       <div className="flex items-center gap-3">
                         <UserCheck size={20} />
                         <span className="font-bold text-sm">Gestionar como Reembolso / Deuda</span>
                       </div>
                       <Check size={20} className={isRefundLink ? 'text-blue-600 dark:text-blue-400 opacity-100' : 'opacity-0'} />
                     </button>

                     {isRefundLink && (
                       <div className="mt-4 p-5 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border-2 border-blue-100 dark:border-blue-800 space-y-4 animate-in slide-in-from-top-2 duration-300">
                         {type === 'expense' ? (
                           <>
                             <label className="block text-[11px] font-black text-blue-700 dark:text-blue-400 uppercase">Tu Parte (Gasto Neto)</label>
                             <input type="number" step="0.01" value={myPartManual} onChange={e => setMyPartManual(e.target.value === '' ? '' : Number(e.target.value))} className="w-full bg-white dark:bg-slate-800 border-2 border-blue-200 dark:border-blue-700 rounded-xl p-4 font-black outline-none text-center text-slate-900 dark:text-white" placeholder="Cuanto pagas tú" />
                           </>
                         ) : (
                           <>
                             <label className="block text-[11px] font-black text-blue-700 dark:text-blue-400 uppercase">Vincular a Deuda</label>
                             <select value={selectedRefundId} onChange={e => setSelectedRefundId(e.target.value)} className="w-full bg-white dark:bg-slate-800 border-2 border-blue-200 dark:border-blue-700 rounded-xl p-4 font-bold outline-none text-slate-900 dark:text-white" required>
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

              <div className="flex flex-col gap-3 pt-6">
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={close}
                    className="flex-1 py-5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400 font-black rounded-2xl transition-colors"
                  >
                    CANCELAR
                  </button>

                  {scannedQueue.length > 0 && (
                    <button
                      type="button"
                      onClick={handleDiscardCurrentScanned}
                      className="flex-1 py-5 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 font-black rounded-2xl border-2 border-rose-100 dark:border-rose-900/50 transition-all hover:bg-rose-100"
                    >
                      DESCARTAR
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  className="w-full py-5 bg-blue-600 text-white font-black rounded-2xl shadow-xl shadow-blue-100 dark:shadow-none transition-all active:scale-95"
                >
                  {editingTx ? 'GUARDAR' : scannedQueue.length > 1 ? 'CONFIRMAR Y SIGUIENTE' : 'FINALIZAR Y CONFIRMAR'}
                </button>
              </div>
            </form>
         </div>
     </div>
  );
};

export default TransactionModal;
