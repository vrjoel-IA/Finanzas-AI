
import React, { useState, useMemo, useEffect, useRef } from 'react';
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
import { analyzeReceipt, ScannedTransaction } from '../services/geminiService';

const Transactions: React.FC = () => {
  const { transactions, accounts, savings, refunds, budgets, addTransaction, updateTransaction, deleteTransaction, theme, currentDate, viewMode, startUndoBatch, commitUndoBatch, cancelUndoBatch, undoLastAdd, undoCount } = useFinance();
  const [filter, setFilter] = useState<'all' | 'income' | 'expense' | 'savings' | 'refunds'>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterAccount, setFilterAccount] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [viewingTx, setViewingTx] = useState<Transaction | null>(null);
  const [confirmDeleteInModal, setConfirmDeleteInModal] = useState(false);
  const [undoToast, setUndoToast] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  
  // Aura Vision States
  const [isScanning, setIsScanning] = useState(false);
  const isInScanBatch = useRef(false);
  const [scannedQueue, setScannedQueue] = useState<ScannedTransaction[]>([]);
  const [totalScannedCount, setTotalScannedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const location = useLocation();

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

  // Filter dropdown categories (from budgets)
  const filterCategoriesList = useMemo(() => {
    const cats = Array.from(new Set(budgets.map(b => b.category)));
    // Also include categories used in current-period transactions not in budgets
    transactions.filter(t => t.date.startsWith(currentDate)).forEach(t => {
      if (t.category && !cats.includes(t.category)) cats.push(t.category);
    });
    return cats.sort();
  }, [budgets, transactions, currentDate]);

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

  useEffect(() => {
    if (location.state?.openModal) {
      setIsAdding(true);
      setEditingTx(null);
    }
  }, [location.state]);

  const resetForm = () => {
    setDesc('');
    setAmount('');
    setDate(new Date().toISOString().split('T')[0]);
    setType('expense');
    setCategory('');
    setAccountId(accounts[0]?.id || '');
    setIsRefundLink(false);
    setSelectedRefundId('');
    setSelectedSavingId('');
    setMyPartManual('');
    setIsTransfer(false);
    setTransferTargetId('');
    setEditingTx(null);
    setSavingDirection('deposit');
  };

  const startEdit = (tx: Transaction) => {
    setEditingTx(tx);
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

    setIsAdding(true);
    setViewingTx(null);
    setConfirmDeleteInModal(false);
  };

  const handleDeleteFromModal = (id: string) => {
    deleteTransaction(id);
    setViewingTx(null);
    setConfirmDeleteInModal(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      try {
        const items = await analyzeReceipt(base64);
        const reversedItems = [...items].reverse();
        setScannedQueue(reversedItems);
        setTotalScannedCount(reversedItems.length);
        if (reversedItems.length > 0) {
          // Iniciar batch de undo para toda la sesión de escaneo
          startUndoBatch();
          isInScanBatch.current = true;
          loadScannedItem(reversedItems[0]);
          setIsAdding(true);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsScanning(false);
      }
    };
    reader.readAsDataURL(file);
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
    
    // Mapeo inteligente de categorías para que coincidan con los Presupuestos
    const matchingBudget = budgets.find(b => 
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

  const handleDiscardCurrentScanned = () => {
    const nextQueue = scannedQueue.slice(1);
    setScannedQueue(nextQueue);
    if (nextQueue.length > 0) {
      loadScannedItem(nextQueue[0]);
    } else {
      // Si se descartó el último, commit del batch (puede estar vacío)
      if (isInScanBatch.current) {
        commitUndoBatch('Aura Vision');
        isInScanBatch.current = false;
      }
      setIsAdding(false);
      resetForm();
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
      if (isInScanBatch.current) {
        commitUndoBatch('Aura Vision');
        isInScanBatch.current = false;
      }
      setIsAdding(false);
      resetForm();
    }
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

  const isCategoryDisabled = type === 'income' && isRefundLink && !!selectedRefundId;

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
    <div className="space-y-8 animate-in fade-in duration-500 pb-20 max-w-6xl mx-auto px-4 transition-colors">
      
      {isScanning && (
        <div className="fixed inset-0 bg-slate-900/90 z-[100] flex flex-col items-center justify-center p-6 text-center">
          <div className="relative mb-8">
            <div className="w-32 h-32 border-4 border-blue-500/20 rounded-full border-t-blue-500 animate-spin"></div>
            <Sparkles className="absolute inset-0 m-auto text-blue-500 animate-pulse" size={48} />
          </div>
          <h3 className="text-2xl font-black text-white mb-2">Aura Vision Procesando</h3>
          <p className="text-slate-400 max-w-xs">He recibido tu imagen. Estoy extrayendo y categorizando cada movimiento para ti...</p>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-800 dark:text-white tracking-tight">Transacciones</h2>
          <p className="text-slate-700 dark:text-slate-400 font-bold text-sm">Historial de {viewMode === 'year' ? `todo el año ${currentDate}` : currentDate}.</p>
        </div>
        <div className="flex gap-2">
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
                  className="flex items-center gap-2 px-5 py-4 bg-rose-600 text-white font-black rounded-2xl transition-all shadow-lg active:scale-95 animate-in zoom-in duration-200"
                >
                  Confirmar
                </button>
                <button 
                  onClick={() => setConfirmUndo(false)}
                  className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
                >
                  <X size={20} />
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setConfirmUndo(true)}
                className="flex items-center gap-2 px-5 py-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-black rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm active:scale-95"
              >
                <Undo2 size={20} className="text-amber-500" />
                <span>Deshacer</span>
              </button>
            )
          )}
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isScanning}
            className="flex items-center gap-2 px-6 py-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-black rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm active:scale-95 disabled:opacity-50"
          >
            <Camera size={20} className="text-blue-500" />
            <span>Aura Vision</span>
          </button>
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
          
          <button onClick={() => { setEditingTx(null); setIsAdding(true); }} className="flex items-center gap-2 px-8 py-4 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 dark:shadow-none active:scale-95">
            <Plus size={20} /> 
            <span>Nueva</span>
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-none overflow-hidden transition-all duration-300">
        <div className="p-4 md:p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-4 bg-slate-50/30 dark:bg-slate-800/20">
          
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
                <th className="px-6 py-5 text-left w-[25%] md:w-[20%]">Fecha</th>
                <th className="px-6 py-5 text-left w-[45%] md:w-[50%]">Detalle</th>
                <th className="px-6 py-5 text-right w-[30%]">Importe</th>
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
                    <td className="px-6 py-6 text-[11px] font-black text-slate-500 dark:text-slate-500 uppercase">
                      {new Date(tx.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                    </td>
                    <td className="px-6 py-6">
                      <div className="flex items-center gap-4 overflow-hidden">
                        <div className={`flex w-9 h-9 rounded-xl items-center justify-center flex-shrink-0 shadow-sm ${style.bg} ${style.color}`}>
                          {style.icon}
                        </div>
                        <div className="min-w-0 flex flex-col">
                          <span className="font-black text-slate-800 dark:text-slate-100 text-[13px] truncate leading-tight transition-colors">
                            {tx.description}
                          </span>
                          <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider mt-0.5 truncate">{tx.category}</span>
                        </div>
                      </div>
                    </td>
                    <td className={`px-6 py-6 text-right font-black text-lg ${style.color}`}>
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

      {isAdding && (
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
                  <button onClick={() => { 
                    if (isInScanBatch.current) {
                      commitUndoBatch('Aura Vision');
                      isInScanBatch.current = false;
                    }
                    setIsAdding(false); resetForm(); setScannedQueue([]); 
                  }} className="p-4 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400"><X size={28} /></button>
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
                        onClick={() => { 
                          if (isInScanBatch.current) {
                            commitUndoBatch('Aura Vision');
                            isInScanBatch.current = false;
                          }
                          setIsAdding(false); resetForm(); setScannedQueue([]); 
                        }} 
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
