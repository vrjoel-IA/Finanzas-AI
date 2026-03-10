
import React, { useState, useMemo } from 'react';
import { useFinance } from '../App';
import { 
  Plus, 
  Edit2, 
  Trash2, 
  ShoppingBag, 
  ChevronRight, 
  X, 
  ArrowUpRight, 
  ArrowDownRight, 
  ArrowLeftRight,
  TrendingDown,
  TrendingUp,
  AlertCircle,
  Calendar,
  Wallet,
  Tag,
  ArrowDownLeft,
  ChevronDown,
  History,
  ArrowRight,
  Palette,
  Check
} from 'lucide-react';
import { Budget, Transaction } from '../types';
import { CATEGORIES, INCOME_CATEGORIES, ICON_MAP, BUDGET_PRESET_COLORS } from '../constants';

const BudgetManager: React.FC = () => {
  const { budgets, transactions, currentDate, updateBudget, addBudget, deleteBudget, accounts, theme } = useFinance();
  
  // UI States
  const [activeTab, setActiveTab] = useState<'expense' | 'income'>('expense');
  const [selectedBudget, setSelectedBudget] = useState<Budget | null>(null);
  const [isEditing, setIsEditing] = useState<Budget | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  // Form States
  const [category, setCategory] = useState('');
  const [limit, setLimit] = useState<number | ''>('');
  const [customCategory, setCustomCategory] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState('ShoppingBag');
  const [selectedColor, setSelectedColor] = useState('#3b82f6');

  // Cálculo dinámico de presupuestos con su gasto real
  const budgetsWithCalculatedSpent = useMemo(() => {
    return budgets.map(b => {
      const calculatedSpent = transactions
        .filter(t => t.date.startsWith(currentDate) && t.category === b.category)
        .reduce((sum, t) => {
          // Para presupuestos de gasto:
          if (b.type === 'expense') {
            if (t.type === 'expense') {
              return sum + t.amount; // Gastos regulares aumentan el 'spent'
            }
            if (t.type === 'income' && t.refundId) {
              return sum - t.amount; // Ingresos por reembolso disminuyen el 'spent'
            }
          }
          // Para presupuestos de ingreso:
          if (b.type === 'income') {
            // Solo cuenta ingresos que NO son reembolsos
            if (t.type === 'income' && !t.refundId) {
              return sum + t.amount; // Ingresos regulares (ej: nómina) aumentan el 'spent'
            }
          }
          return sum; // No cuenta otros tipos de transacciones
        }, 0);
      
      const totalRefunded = transactions
        .filter(t => t.date.startsWith(currentDate) && t.category === b.category && t.type === 'income' && !!t.refundId)
        .reduce((sum, t) => sum + t.amount, 0);
      
      return { ...b, spent: calculatedSpent, totalRefunded };
    });
  }, [budgets, transactions, currentDate]);

  const filteredBudgets = useMemo(() => {
    return budgetsWithCalculatedSpent.filter(b => b.type === activeTab);
  }, [budgetsWithCalculatedSpent, activeTab]);

  const budgetTransactions = useMemo(() => {
    if (!selectedBudget) return [];
    return transactions.filter(t => 
      t.category === selectedBudget.category && 
      t.date.startsWith(currentDate)
    ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [selectedBudget, transactions, currentDate]);

  const totals = useMemo(() => {
    const b = budgetsWithCalculatedSpent.filter(x => x.type === activeTab);
    return {
      limit: b.reduce((s, x) => s + x.limit, 0),
      actual: b.reduce((s, x) => s + x.spent, 0)
    };
  }, [budgetsWithCalculatedSpent, activeTab]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const finalCategory = isCustomMode ? customCategory : category;
    if (!finalCategory || limit === '') return;

    if (isEditing) {
      updateBudget({ 
        ...isEditing, 
        category: finalCategory, 
        limit: Number(limit), 
        icon: selectedIcon, 
        color: selectedColor 
      });
      setIsEditing(null);
    } else {
      addBudget({ 
        category: finalCategory, 
        limit: Number(limit), 
        type: activeTab,
        icon: selectedIcon,
        color: selectedColor
      });
      setIsCreating(false);
    }
    resetForm();
  };

  const resetForm = () => {
    setCategory('');
    setLimit('');
    setCustomCategory('');
    setIsCustomMode(false);
    setSelectedIcon('ShoppingBag');
    setSelectedColor('#3b82f6');
  };

  const openCreate = () => {
    resetForm();
    const defaultCats = activeTab === 'expense' ? CATEGORIES : INCOME_CATEGORIES;
    setCategory(defaultCats[0].name);
    setSelectedIcon(defaultCats[0].icon);
    setSelectedColor(defaultCats[0].color);
    setIsCreating(true);
  };

  const openEdit = (b: Budget) => {
    const defaultCats = b.type === 'expense' ? CATEGORIES : INCOME_CATEGORIES;
    const isStandard = defaultCats.some(c => c.name === b.category);
    
    setCategory(isStandard ? b.category : 'Otra');
    setCustomCategory(isStandard ? '' : b.category);
    setIsCustomMode(!isStandard);
    setLimit(b.limit);
    setSelectedIcon(b.icon);
    setSelectedColor(b.color || '#3b82f6');
    setIsEditing(b);
  };

  const handleDeleteClick = (e: React.MouseEvent, budgetId: string) => {
    e.stopPropagation();
    if (deletingId === budgetId) {
      deleteBudget(budgetId);
      setDeletingId(null);
    } else {
      setDeletingId(budgetId);
      setTimeout(() => {
        setDeletingId(prev => prev === budgetId ? null : prev);
      }, 3000);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20 transition-colors">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-800 dark:text-white tracking-tight">Presupuestos</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium tracking-tight transition-colors">Controla tus finanzas de {currentDate} con precisión.</p>
        </div>
        <button 
          onClick={openCreate}
          className="flex items-center gap-2 px-8 py-4 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 dark:shadow-none active:scale-95"
        >
          <Plus size={20} />
          Nuevo Límite
        </button>
      </div>

      <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-3xl w-full md:w-fit border border-slate-200 dark:border-slate-700 shadow-inner">
        <button 
          onClick={() => setActiveTab('expense')} 
          className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-8 py-3 text-xs font-black rounded-2xl transition-all ${activeTab === 'expense' ? 'bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-md' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
        >
          <TrendingDown size={16} /> GASTOS
        </button>
        <button 
          onClick={() => setActiveTab('income')} 
          className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-8 py-3 text-xs font-black rounded-2xl transition-all ${activeTab === 'income' ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-md' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
        >
          <TrendingUp size={16} /> INGRESOS
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className={`p-6 rounded-[2.5rem] border shadow-sm flex items-center gap-4 bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 transition-colors`}>
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${activeTab === 'expense' ? 'bg-rose-50 dark:bg-rose-900/40 text-rose-500 dark:text-rose-400' : 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-500 dark:text-emerald-400'}`}>
            <ShoppingBag size={24} />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Total {activeTab === 'expense' ? 'Presupuestado' : 'Objetivo'}</p>
            <p className="text-2xl font-black text-slate-800 dark:text-white transition-colors">{totals.limit.toLocaleString()}€</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4 transition-colors">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400`}>
            <ArrowLeftRight size={24} />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{activeTab === 'expense' ? 'Consumo Real' : 'Ingreso Real'}</p>
            <p className="text-2xl font-black text-blue-600 dark:text-blue-400 transition-colors">{totals.actual.toLocaleString()}€</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredBudgets.map(b => {
          const progress = b.limit > 0 ? Math.min((b.spent / b.limit) * 100, 100) : 0;
          const isOverBudget = activeTab === 'expense' && b.spent > b.limit;
          const isConfirmingDelete = deletingId === b.id;
          
          return (
            <div 
              key={b.id} 
              onClick={() => setSelectedBudget(b)}
              className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-all group cursor-pointer active:scale-[0.99] duration-300"
            >
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-4">
                  <div 
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-inner dark:shadow-none transition-colors`}
                    style={{ backgroundColor: `${b.color}${theme === 'dark' ? '30' : '15'}`, color: b.color }}
                  >
                    {ICON_MAP[b.icon] ? (
                      React.cloneElement(ICON_MAP[b.icon] as React.ReactElement, { size: 24 })
                    ) : (
                      <span className="text-2xl">{b.icon || <Tag size={24} />}</span>
                    )}
                  </div>
                  <div>
                    <h4 className="text-lg font-black text-slate-800 dark:text-white tracking-tight transition-colors">{b.category}</h4>
                    <p className="text-xs text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">{activeTab === 'expense' ? 'Gasto' : 'Ingreso'}</p>
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button 
                    onClick={(e) => { e.stopPropagation(); openEdit(b); }} 
                    className="p-2.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/40 rounded-xl transition-colors"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button 
                    onClick={(e) => handleDeleteClick(e, b.id)} 
                    className={`p-2.5 rounded-xl transition-all flex items-center gap-1 ${
                      isConfirmingDelete 
                        ? 'bg-rose-600 text-white animate-pulse' 
                        : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/40'
                    }`}
                  >
                    {isConfirmingDelete ? (
                      <>
                        <Check size={18} />
                        <span className="text-[10px] font-black uppercase">¿Borrar?</span>
                      </>
                    ) : (
                      <Trash2 size={18} />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-5">
                <div className="flex justify-between items-end">
                   <div>
                      <p className={`text-4xl font-black tracking-tight ${isOverBudget ? 'text-rose-500 dark:text-rose-400' : 'text-slate-900 dark:text-white'} transition-colors`}>{b.spent.toLocaleString('es-ES')}€</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-black uppercase tracking-widest transition-colors">de {b.limit.toLocaleString()}€ {activeTab === 'expense' ? 'definidos' : 'objetivo'}</p>
                   </div>
                   <div className="text-right">
                      <span 
                        style={!isOverBudget ? { backgroundColor: `${b.color}${theme === 'dark' ? '30' : '15'}`, color: b.color } : {}}
                        className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-colors ${isOverBudget ? 'bg-rose-50 dark:bg-rose-900/40 text-rose-500 dark:text-rose-400' : ''}`}
                      >
                        {activeTab === 'expense' ? (isOverBudget ? 'Excedido' : progress > 85 ? 'Cuidado' : 'Correcto') : (b.spent >= b.limit ? 'Logrado' : 'En progreso')}
                      </span>
                   </div>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-3 rounded-full overflow-hidden transition-colors">
                  <div 
                    className={`h-full rounded-full transition-all duration-1000 ease-out`} 
                    style={{ 
                      width: `${progress}%`,
                      backgroundColor: isOverBudget ? (theme === 'dark' ? '#f43f5e' : '#f43f5e') : b.color 
                    }}
                  ></div>
                </div>

                {(b.totalRefunded || 0) > 0 && (
                  <p className="text-[10px] font-black flex items-center gap-1.5 transition-all" style={{ color: b.color }}>
                     <ChevronRight size={12} className="shrink-0" /> 
                     Reembolsado: +{(b.totalRefunded || 0).toLocaleString()}€ (Ahorro en gasto neto)
                  </p>
                )}

                <div className="flex items-center justify-between border-t border-slate-50 dark:border-slate-800 pt-3">
                   <p className="text-xs text-slate-400 dark:text-slate-500 font-bold flex items-center gap-1 transition-colors"><ChevronRight size={14} style={{ color: b.color }} /> Ver detalles</p>
                   {activeTab === 'expense' && b.limit > b.spent && (
                     <p className="text-xs font-black text-slate-700 dark:text-slate-300 transition-colors">Dispones de {(b.limit - b.spent).toLocaleString()}€ más</p>
                   )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Ver Detalles */}
      {selectedBudget && (
        <div className="fixed inset-0 bg-slate-900/90 z-[60] flex items-center justify-center p-4" onClick={() => setSelectedBudget(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-[3rem] w-full max-w-lg p-8 md:p-10 shadow-2xl animate-in fade-in zoom-in duration-300 border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-8 flex-shrink-0">
               <div className="flex items-center gap-5">
                  <div 
                    className={`w-16 h-16 rounded-[1.5rem] flex items-center justify-center shadow-lg dark:shadow-none transition-colors`}
                    style={{ backgroundColor: `${selectedBudget.color}${theme === 'dark' ? '30' : '15'}`, color: selectedBudget.color }}
                  >
                    {ICON_MAP[selectedBudget.icon] ? (
                      React.cloneElement(ICON_MAP[selectedBudget.icon] as React.ReactElement, { size: 28 })
                    ) : (
                      <span className="text-3xl">{selectedBudget.icon || <Tag size={28} />}</span>
                    )}
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{selectedBudget.category}</h3>
                    <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Movimientos de {currentDate}</p>
                  </div>
               </div>
               <button onClick={() => setSelectedBudget(null)} className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400"><X size={24} /></button>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-3xl p-6 mb-8 border border-slate-100 dark:border-slate-800 flex-shrink-0 transition-colors">
               <div className="flex justify-between items-end mb-4">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1">Total acumulado</p>
                    <p className="text-3xl font-black text-slate-900 dark:text-white transition-colors">{selectedBudget.spent.toLocaleString()}€</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1">Límite</p>
                    <p className="text-lg font-bold text-slate-600 dark:text-slate-400 transition-colors">{selectedBudget.limit.toLocaleString()}€</p>
                  </div>
               </div>
               <div className="w-full h-3 bg-white dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700">
                  <div 
                    className={`h-full rounded-full transition-all duration-1000`} 
                    style={{ 
                      width: `${Math.min((selectedBudget.spent / selectedBudget.limit) * 100, 100)}%`,
                      backgroundColor: (selectedBudget.type === 'expense' && selectedBudget.spent > selectedBudget.limit) ? '#f43f5e' : selectedBudget.color 
                    }}
                  ></div>
               </div>
            </div>

            <div className="flex items-center gap-2 mb-4 flex-shrink-0">
              <History size={16} className="text-slate-400 dark:text-slate-600" />
              <h4 className="text-xs font-black text-slate-500 dark:text-slate-500 uppercase tracking-widest">Historial Reciente</h4>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-2">
              {budgetTransactions.length > 0 ? budgetTransactions.map(tx => (
                <div key={tx.id} className="flex justify-between items-center p-4 bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-2xl hover:border-blue-200 dark:hover:border-blue-800 transition-colors duration-300">
                  <div className="flex items-center gap-4">
                    <div className="text-center bg-slate-50 dark:bg-slate-900 w-10 py-1.5 rounded-xl border border-slate-100 dark:border-slate-700 transition-colors">
                      <p className="text-[8px] font-black text-slate-400 dark:text-slate-600 uppercase">{new Date(tx.date).toLocaleDateString('es-ES', { month: 'short' })}</p>
                      <p className="text-xs font-black text-slate-700 dark:text-slate-300 transition-colors">{new Date(tx.date).getDate()}</p>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-200 line-clamp-1 transition-colors">{tx.description}</p>
                      <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500">{accounts.find(a => a.id === tx.accountId)?.name || 'Cuenta'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-black ${tx.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'} transition-colors`}>
                      {tx.type === 'income' ? '+' : '-'}{tx.amount.toLocaleString()}€
                    </p>
                  </div>
                </div>
              )) : (
                <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/30 rounded-[2rem] border-2 border-dashed border-slate-200 dark:border-slate-700 transition-colors">
                  <AlertCircle size={32} className="mx-auto text-slate-300 dark:text-slate-700 mb-3" />
                  <p className="text-xs font-bold text-slate-400 dark:text-slate-600 uppercase tracking-widest">No hay transacciones aún</p>
                </div>
              )}
            </div>
            
            <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 flex-shrink-0">
               <button onClick={() => setSelectedBudget(null)} className="w-full py-4 bg-slate-900 dark:bg-blue-600 text-white font-black rounded-2xl hover:bg-slate-800 dark:hover:bg-blue-700 transition-all active:scale-[0.98]">ENTENDIDO</button>
            </div>
          </div>
        </div>
      )}

      {(isCreating || isEditing) && (
        <div className="fixed inset-0 bg-slate-900/90 z-[60] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[3.5rem] w-full max-w-md p-10 md:p-14 shadow-2xl animate-in fade-in zoom-in duration-300 border border-slate-100 dark:border-slate-800 overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-10">
              <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">{isEditing ? 'Editar Límite' : 'Nueva Categoría'}</h3>
              <button onClick={() => { setIsCreating(false); setIsEditing(null); }} className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 transition-colors"><X size={24} /></button>
            </div>
            
            <form onSubmit={handleSave} className="space-y-8">
              <div className="space-y-4">
                <label className="block text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest pl-1">Icono o Emoji</label>
                <input 
                  type="text" 
                  value={selectedIcon} 
                  onChange={e => setSelectedIcon(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-4 text-center text-xl outline-none text-slate-900 dark:text-white focus:border-blue-500 transition-all"
                  placeholder="🛍️"
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="block text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest pl-1">Personalizar Color</label>
                  <div className="flex items-center gap-2">
                    <input 
                      type="color" 
                      value={selectedColor} 
                      onChange={e => setSelectedColor(e.target.value)}
                      className="w-10 h-10 border-0 bg-transparent cursor-pointer rounded-full overflow-hidden shadow-sm transition-transform hover:scale-105"
                    />
                    <Palette size={16} className="text-slate-400 dark:text-slate-600" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {BUDGET_PRESET_COLORS.map(c => (
                    <button 
                      key={c}
                      type="button"
                      onClick={() => setSelectedColor(c)}
                      className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${selectedColor === c ? 'border-slate-900 dark:border-white scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <label className="block text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest pl-1">Categoría</label>
                <div className="relative">
                  <select 
                    value={category} 
                    onChange={e => {
                      setCategory(e.target.value);
                      const isAnother = e.target.value === 'Otra';
                      setIsCustomMode(isAnother);
                      if(!isAnother) {
                        const defaultList = activeTab === 'expense' ? CATEGORIES : INCOME_CATEGORIES;
                        const match = defaultList.find(c => c.name === e.target.value);
                        if(match) {
                          setSelectedIcon(match.icon);
                          setSelectedColor(match.color);
                        }
                      }
                    }}
                    className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-black text-slate-800 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:border-blue-400 dark:focus:border-blue-600 outline-none transition-all appearance-none cursor-pointer"
                    required
                  >
                    {(activeTab === 'expense' ? CATEGORIES : INCOME_CATEGORIES).map(c => (
                      <option key={c.name} value={c.name} className="dark:bg-slate-900">{c.name}</option>
                    ))}
                    <option value="Otra" className="dark:bg-slate-900">-- Personalizada --</option>
                  </select>
                  <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-600 pointer-events-none" size={20} />
                </div>
                {isCustomMode && (
                  <input type="text" placeholder="Nombre de categoría..." className="w-full bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-100 dark:border-blue-900 rounded-2xl p-5 font-black text-blue-900 dark:text-blue-300 outline-none animate-in slide-in-from-top-2" value={customCategory} onChange={e => setCustomCategory(e.target.value)} required />
                )}
              </div>

              <div className="space-y-4">
                <label className="block text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest pl-1">Importe Mensual (€)</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={limit} 
                  onChange={e => setLimit(e.target.value === '' ? '' : Number(e.target.value))} 
                  className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-6 text-center text-4xl font-black text-slate-900 dark:text-white outline-none" 
                  placeholder="0" 
                  required 
                />
              </div>

              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => { setIsCreating(false); setIsEditing(null); }} className="flex-1 py-5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400 font-black rounded-2xl transition-colors">CANCELAR</button>
                <button type="submit" className="flex-1 py-5 bg-blue-600 text-white font-black rounded-2xl shadow-xl shadow-blue-100 dark:shadow-none flex items-center justify-center gap-2 transition-all active:scale-[0.98]">{isEditing ? <Edit2 size={18}/> : <Plus size={18}/>}{isEditing ? 'GUARDAR' : 'CREAR'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetManager;
