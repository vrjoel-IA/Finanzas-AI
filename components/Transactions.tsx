
import React, { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useFinance } from '../App';
import { 
  Plus, 
  Search, 
  ArrowUpRight, 
  ArrowDownRight, 
  Trash2, 
  Edit2, 
  X, 
  UserCheck, 
  AlertCircle, 
  Check, 
  PiggyBank, 
  ChevronDown, 
  Split,
  Camera,
  Loader2,
  Sparkles,
  ArrowRightLeft,
  ArrowRight,
  Ban,
  ArrowDownCircle,
  ArrowUpCircle,
  Filter,
  SlidersHorizontal,
  Undo2
} from 'lucide-react';
import { Transaction } from '../types';

import TransactionModal from './TransactionModal';
import { useAuraVision } from './AuraVision';
const Transactions: React.FC = () => {
  const { transactions, accounts, budgets, deleteTransaction, currentDate, viewMode, undoLastAdd, undoCount } = useFinance();
  const { openPicker, isScanning } = useAuraVision();
  const [filter, setFilter] = useState<'all' | 'income' | 'expense' | 'savings' | 'refunds'>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterAccount, setFilterAccount] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  // Formulario de movimiento (alta o edicion). Vive en TransactionModal; Aura
  // Vision abre el suyo desde AuraVisionProvider, sobre cualquier pantalla.
  const [modal, setModal] = useState<{ editingTx: Transaction | null } | null>(null);
  const [viewingTx, setViewingTx] = useState<Transaction | null>(null);
  const [confirmDeleteInModal, setConfirmDeleteInModal] = useState(false);
  const [undoToast, setUndoToast] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);

  const location = useLocation();

  // Filter dropdown categories (from budgets)
  const filterCategoriesList = useMemo(() => {
    // Los objetivos de ahorro llevan el nombre de la hucha, no una categoria.
    const cats = Array.from(new Set(budgets.filter(b => b.type !== 'saving').map(b => b.category)));
    // Also include categories used in current-period transactions not in budgets
    transactions.filter(t => t.date.startsWith(currentDate)).forEach(t => {
      if (t.category && !cats.includes(t.category)) cats.push(t.category);
    });
    return cats.sort();
  }, [budgets, transactions, currentDate]);

  useEffect(() => {
    if (location.state?.openModal) {
      setModal({ editingTx: null });
    }
    // Llegada desde el anillo de categorias del dashboard: se abre la lista ya
    // filtrada por esa categoria, para no repetir el filtro a mano.
    if (location.state?.filterCategory) {
      setFilterCategory(location.state.filterCategory);
      setFilter('all');
    }
  }, [location.state]);

  const startEdit = (tx: Transaction) => {
    setModal({ editingTx: tx });
    setViewingTx(null);
    setConfirmDeleteInModal(false);
  };

  const handleDeleteFromModal = (id: string) => {
    deleteTransaction(id);
    setViewingTx(null);
    setConfirmDeleteInModal(false);
  };

  const filteredTx = useMemo(() => {
    return transactions
      .filter(t => {
        const matchesPeriod = t.date.startsWith(currentDate);
        if (!matchesPeriod) return false;

        let matchesType = true;
        const isSaving = t.category === 'Ahorro' || t.category === 'Ahorros' || !!t.savingId;
        const isRefund = t.type === 'income' && !!t.refundId;
        
        if (filter === 'income') matchesType = t.type === 'income' && !t.refundId && !isSaving;
        else if (filter === 'expense') matchesType = t.type === 'expense' && !isSaving;
        else if (filter === 'savings') matchesType = isSaving;
        else if (filter === 'refunds') matchesType = isRefund;

        // Category filter
        const matchesCat = filterCategory === 'all' || t.category === filterCategory;

        // Account filter
        const matchesAcc = filterAccount === 'all' || t.accountId === filterAccount;

        const matchesSearch = t.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
                              t.category.toLowerCase().includes(searchTerm.toLowerCase());

        return matchesType && matchesCat && matchesAcc && matchesSearch;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, filter, filterCategory, filterAccount, searchTerm, currentDate]);

  const getTxStyle = (t: Transaction) => {
    const isSaving = t.category === 'Ahorro' || t.category === 'Ahorros' || !!t.savingId;
    const isRefund = t.type === 'income' && !!t.refundId;
    const isWithdrawal = isSaving && t.type === 'income';

    if (isSaving) {
        return { 
            color: isWithdrawal ? 'text-amber-600 dark:text-amber-400' : 'text-amber-500', 
            bg: 'bg-amber-50 dark:bg-amber-900/40', 
            icon: isWithdrawal ? <ArrowDownCircle size={18} /> : <ArrowUpRight size={18} /> 
        };
    }
    if (isRefund) return { color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/40', icon: <ArrowUpRight size={18} /> }; 
    if (t.type === 'income') return { color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/40', icon: <ArrowUpRight size={18} /> }; 
    return { color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-900/40', icon: <ArrowDownRight size={18} /> }; 
  };

  // Helper: count of active filters
  const activeFilterCount = (filterCategory !== 'all' ? 1 : 0) + (filterAccount !== 'all' ? 1 : 0) + (filter !== 'all' ? 1 : 0);

  // Type filter label map
  const typeFilterLabels: Record<string, string> = {
    'all': 'Todos',
    'income': 'Ingresos',
    'expense': 'Gastos',
    'savings': 'Ahorros',
    'refunds': 'Reembolsos'
  };
  const typeFilterColors: Record<string, string> = {
    'all': 'bg-slate-900 dark:bg-slate-600',
    'income': 'bg-emerald-500 dark:bg-emerald-600',
    'expense': 'bg-rose-500 dark:bg-rose-600',
    'savings': 'bg-amber-500 dark:bg-amber-600',
    'refunds': 'bg-blue-500 dark:bg-blue-600'
  };

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-20 max-w-6xl mx-auto px-2 md:px-4 transition-colors">
      

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-black text-slate-800 dark:text-white tracking-tight">Transacciones</h2>
          <p className="text-slate-700 dark:text-slate-400 font-bold text-xs md:text-sm">Historial de {viewMode === 'year' ? `todo el año ${currentDate}` : currentDate}.</p>
        </div>
        <div className="flex gap-1.5 md:gap-2 items-center flex-shrink-0">
          {undoCount > 0 && (
            confirmUndo ? (
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => {
                    const result = undoLastAdd();
                    setConfirmUndo(false);
                    if (result) {
                      const count = result.ids.length;
                      setUndoToast(`Deshecho: ${result.label} (${count} mov.)`);
                      setTimeout(() => setUndoToast(null), 3000);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 md:px-5 py-3 md:py-4 bg-rose-600 text-white font-black text-xs md:text-sm rounded-xl md:rounded-2xl transition-all shadow-lg active:scale-95 animate-in zoom-in duration-200"
                >
                  <Check size={16} />
                  <span className="hidden md:inline">Confirmar</span>
                </button>
                <button 
                  onClick={() => setConfirmUndo(false)}
                  className="p-3 md:p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 rounded-xl md:rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setConfirmUndo(true)}
                className="flex items-center gap-1.5 p-3 md:px-5 md:py-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-black rounded-xl md:rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm active:scale-95"
                title="Deshacer"
              >
                <Undo2 size={18} className="text-amber-500" />
                <span className="hidden md:inline text-sm">Deshacer</span>
              </button>
            )
          )}
          <button 
            onClick={openPicker}
            disabled={isScanning}
            className="flex items-center gap-1.5 p-3 md:px-5 md:py-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-black rounded-xl md:rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm active:scale-95 disabled:opacity-50"
            title="Aura Vision"
          >
            <Camera size={18} className="text-blue-500" />
            <span className="hidden md:inline text-sm">Aura Vision</span>
          </button>
          
          <button onClick={() => setModal({ editingTx: null })} className="flex items-center gap-1.5 px-4 py-3 md:px-8 md:py-4 bg-blue-600 text-white font-black text-sm rounded-xl md:rounded-2xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 dark:shadow-none active:scale-95">
            <Plus size={18} /> 
            <span>Nueva</span>
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-none overflow-hidden transition-all duration-300">
        <div className="p-3 md:p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-3 md:gap-4 bg-slate-50/30 dark:bg-slate-800/20">
          
          {/* Filter Dropdowns Row */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Type Filter Dropdown */}
            <div className="relative flex-1 min-w-0">
              <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.15em] mb-1.5 ml-1">Tipo</label>
              <div className="relative">
                <select 
                  value={filter} 
                  onChange={e => setFilter(e.target.value as any)}
                  className="w-full appearance-none bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 pr-10 text-[11px] font-black text-slate-800 dark:text-white uppercase tracking-wider outline-none cursor-pointer transition-all focus:border-blue-400 dark:focus:border-blue-600 hover:border-slate-300 dark:hover:border-slate-600"
                >
                  <option value="all">Todos</option>
                  <option value="income">Ingresos</option>
                  <option value="expense">Gastos</option>
                  <option value="savings">Ahorros</option>
                  <option value="refunds">Reembolsos</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" size={14} />
                {filter !== 'all' && (
                  <div className={`absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${typeFilterColors[filter]}`} />
                )}
              </div>
            </div>

            {/* Category Filter Dropdown */}
            <div className="relative flex-1 min-w-0">
              <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.15em] mb-1.5 ml-1">Categoría</label>
              <div className="relative">
                <select 
                  value={filterCategory} 
                  onChange={e => setFilterCategory(e.target.value)}
                  className="w-full appearance-none bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 pr-10 text-[11px] font-black text-slate-800 dark:text-white uppercase tracking-wider outline-none cursor-pointer transition-all focus:border-blue-400 dark:focus:border-blue-600 hover:border-slate-300 dark:hover:border-slate-600"
                >
                  <option value="all">Todas</option>
                  {filterCategoriesList.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" size={14} />
                {filterCategory !== 'all' && (
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-violet-500" />
                )}
              </div>
            </div>

            {/* Account Filter Dropdown */}
            <div className="relative flex-1 min-w-0">
              <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.15em] mb-1.5 ml-1">Cuenta</label>
              <div className="relative">
                <select 
                  value={filterAccount} 
                  onChange={e => setFilterAccount(e.target.value)}
                  className="w-full appearance-none bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 pr-10 text-[11px] font-black text-slate-800 dark:text-white uppercase tracking-wider outline-none cursor-pointer transition-all focus:border-blue-400 dark:focus:border-blue-600 hover:border-slate-300 dark:hover:border-slate-600"
                >
                  <option value="all">Todas</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.emoji || ''} {a.name}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" size={14} />
                {filterAccount !== 'all' && (
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-cyan-500" />
                )}
              </div>
            </div>

            {/* Clear filters button */}
            {activeFilterCount > 0 && (
              <div className="flex items-end">
                <button 
                  onClick={() => { setFilter('all'); setFilterCategory('all'); setFilterAccount('all'); }}
                  className="flex items-center gap-1.5 px-4 py-3 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-wider hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95 border-2 border-transparent whitespace-nowrap"
                >
                  <X size={12} />
                  Limpiar ({activeFilterCount})
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 bg-white dark:bg-slate-800 px-5 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 w-full shadow-sm focus-within:ring-2 focus-within:ring-blue-500 transition-all">
            <Search size={18} className="text-slate-500 dark:text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar transacción..." 
              className="bg-transparent border-none focus:ring-0 text-sm w-full font-bold text-slate-800 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600" 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="w-full overflow-hidden">
          <table className="w-full border-collapse table-fixed">
            <thead>
              <tr className="bg-slate-50/50 dark:bg-slate-800/30 text-[10px] uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 font-black border-b border-slate-100 dark:border-slate-800">
                <th className="px-2 md:px-6 py-4 md:py-5 text-left w-[22%] md:w-[20%]">Fecha</th>
                <th className="px-2 md:px-6 py-4 md:py-5 text-left w-[48%] md:w-[50%]">Detalle</th>
                <th className="px-2 md:px-6 py-4 md:py-5 text-right w-[30%]">Importe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {filteredTx.map(tx => {
                const style = getTxStyle(tx);
                return (
                  <tr 
                    key={tx.id} 
                    onClick={() => { setViewingTx(tx); setConfirmDeleteInModal(false); }}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all group cursor-pointer active:bg-slate-100 dark:active:bg-slate-800"
                  >
                    <td className="px-2 md:px-6 py-4 md:py-6 text-[11px] font-black text-slate-500 dark:text-slate-500 uppercase">
                      {new Date(tx.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                    </td>
                    <td className="px-2 md:px-6 py-4 md:py-6">
                      <div className="flex items-center gap-2.5 md:gap-4 overflow-hidden">
                        <div className={`flex w-8 h-8 md:w-9 md:h-9 rounded-lg md:rounded-xl items-center justify-center flex-shrink-0 shadow-sm ${style.bg} ${style.color}`}>
                          {style.icon}
                        </div>
                        <div className="min-w-0 flex flex-col">
                          <span className="font-black text-slate-800 dark:text-slate-100 text-[12px] md:text-[13px] truncate leading-tight transition-colors">
                            {tx.description}
                          </span>
                          <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider mt-0.5 truncate">{tx.category}</span>
                        </div>
                      </div>
                    </td>
                    <td className={`px-2 md:px-6 py-4 md:py-6 text-right font-black text-base md:text-lg ${style.color}`}>
                      {tx.type === 'income' ? '+' : '-'}{Math.abs(tx.amount).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredTx.length === 0 && (
            <div className="py-24 text-center flex flex-col items-center gap-4">
               <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800 text-slate-300 dark:text-slate-700 rounded-full flex items-center justify-center"><AlertCircle size={32} /></div>
               <p className="text-slate-400 dark:text-slate-600 font-bold italic uppercase tracking-widest text-[11px]">No se encontraron movimientos en este periodo</p>
            </div>
          )}
        </div>
      </div>

      {viewingTx && (
        <div className="fixed inset-0 bg-slate-900/90 z-[80] flex items-center justify-center p-4" onClick={() => { setViewingTx(null); setConfirmDeleteInModal(false); }}>
          <div className="bg-white dark:bg-slate-900 rounded-[3rem] w-full max-w-md p-10 shadow-2xl animate-in zoom-in duration-300 border border-slate-100 dark:border-slate-800" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col items-center text-center gap-8">
              <div className={`w-24 h-24 rounded-[2rem] flex items-center justify-center shadow-lg ${getTxStyle(viewingTx).bg} ${getTxStyle(viewingTx).color}`}>
                {React.cloneElement(getTxStyle(viewingTx).icon as React.ReactElement<{size: number}>, { size: 48 })}
              </div>
              
              <div>
                <p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] mb-2">{viewingTx.category}</p>
                <h3 className="text-2xl font-black text-slate-900 dark:text-white leading-tight">
                  {viewingTx.description}
                </h3>
              </div>

              <div className="w-full bg-slate-50 dark:bg-slate-800 rounded-[2.5rem] p-8 space-y-5 border border-slate-100 dark:border-slate-700 transition-colors">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Monto</span>
                  <span className={`text-3xl font-black ${getTxStyle(viewingTx).color}`}>
                    {viewingTx.type === 'income' ? '+' : '-'}{Math.abs(viewingTx.amount).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€
                  </span>
                </div>
                <div className="h-px bg-slate-200 dark:bg-slate-700 w-full opacity-50"></div>
                <div className="flex justify-between items-center text-sm font-black text-slate-800 dark:text-slate-200">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Cuenta</span>
                  <span>{accounts.find(a => a.id === viewingTx.accountId)?.name || 'Desconocida'}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 w-full">
                <button onClick={() => startEdit(viewingTx)} className="py-5 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-black rounded-2xl flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all">
                  <Edit2 size={18} /> EDITAR
                </button>
                {confirmDeleteInModal ? (
                  <button onClick={() => handleDeleteFromModal(viewingTx.id)} className="py-5 bg-rose-600 text-white font-black rounded-2xl animate-in zoom-in">CONFIRMAR</button>
                ) : (
                  <button onClick={() => setConfirmDeleteInModal(true)} className="py-5 bg-rose-50 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 border-2 border-rose-100 dark:border-rose-900/50 font-black rounded-2xl flex items-center justify-center gap-2 transition-all">
                    <Trash2 size={18} /> BORRAR
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <TransactionModal
          key={modal.editingTx ? modal.editingTx.id : 'nuevo'}
          editingTx={modal.editingTx}
          scannedItems={null}
          onClose={() => setModal(null)}
        />
      )}
      {undoToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[90] animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="flex items-center gap-3 bg-slate-900 dark:bg-slate-700 text-white px-6 py-4 rounded-2xl shadow-2xl border border-slate-700 dark:border-slate-600">
            <Undo2 size={18} className="text-amber-400" />
            <span className="text-sm font-bold">{undoToast}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default Transactions;
