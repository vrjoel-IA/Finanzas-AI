
import React, { useState, useMemo, useEffect } from 'react';
import { useFinance } from '../App';
import { 
  Plus, 
  CheckCircle2, 
  Users, 
  Trash2, 
  Merge, 
  X, 
  Edit3, 
  Save, 
  MessageSquare,
  Check,
  TrendingUp,
  AlertCircle,
  AlignLeft,
  ChevronDown
} from 'lucide-react';
import { Refund } from '../types';

const Refunds: React.FC = () => {
  const { budgets, refunds, addRefund, updateRefund, deleteRefund, mergeRefunds } = useFinance();
  
  // UI States
  const [isAdding, setIsAdding] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeSelection, setMergeSelection] = useState<string[]>([]);
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('open');
  const [selectedRefundId, setSelectedRefundId] = useState<string | null>(null);
  
  // Obtener categorías de presupuesto (únicamente de gastos)
  const budgetExpenseCategories = useMemo(() => {
    return budgets.filter(b => b.type === 'expense').map(b => b.category);
  }, [budgets]);

  // Form state
  const [name, setName] = useState('');
  const [total, setTotal] = useState<number | ''>('');
  const [myPart, setMyPart] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState('');

  // Sincronizar categoría inicial al abrir el modal basada en los presupuestos existentes
  useEffect(() => {
    if (isAdding && budgetExpenseCategories.length > 0 && !category) {
      setCategory(budgetExpenseCategories[0]);
    }
  }, [isAdding, budgetExpenseCategories]);

  // Notes editing in Modal
  const [modalNotes, setModalNotes] = useState('');

  // Encuentra el reembolso actualmente seleccionado desde el estado global
  const selectedRefund = refunds.find(r => r.id === selectedRefundId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (total === '' || myPart === '' || !category) return;
    const pending = total - myPart;
    addRefund({
      name,
      totalAmount: total,
      paidByMe: myPart,
      pendingAmount: pending,
      status: pending <= 0 ? 'closed' : 'open',
      notes,
      date: new Date().toISOString(),
      category: category
    });
    setIsAdding(false);
    resetForm();
  };

  const resetForm = () => { 
    setName(''); 
    setTotal(''); 
    setMyPart(''); 
    setNotes(''); 
    setCategory(budgetExpenseCategories[0] || ''); 
  };

  const handleCardClick = (r: Refund) => {
    if (isMerging) {
      setMergeSelection(prev => {
        if (prev.includes(r.id)) return prev.filter(x => x !== r.id);
        if (prev.length >= 2) return prev; 
        return [...prev, r.id];
      });
    } else {
      setSelectedRefundId(r.id);
      setModalNotes(r.notes || '');
    }
  };

  const executeMerge = () => {
    if (mergeSelection.length === 2) {
      mergeRefunds(mergeSelection[0], mergeSelection[1]);
      setMergeSelection([]);
      setIsMerging(false);
    }
  };

  const handleActionClick = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    e.preventDefault();
    action();
  };

  const handleSaveNotes = () => {
    if (selectedRefund) {
        updateRefund({ ...selectedRefund, notes: modalNotes });
        setSelectedRefundId(null);
    }
  };

  const filteredRefunds = refunds.filter(r => {
    if (filter === 'all') return true;
    return r.status === filter;
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20 transition-colors">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-800 dark:text-white tracking-tight">Reembolsos</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium tracking-tight">Gestiona deudas pendientes. Los cobros reducen el gasto neto del mes.</p>
        </div>
        <div className="flex gap-2">
          {isMerging && mergeSelection.length === 2 && (
             <button 
                type="button"
                onClick={executeMerge}
                className="flex items-center gap-2 px-6 py-3 bg-amber-600 text-white font-bold rounded-2xl shadow-lg hover:bg-amber-700 transition-all animate-in zoom-in"
             >
                <Check size={18} /> CONFIRMAR FUSIÓN
             </button>
          )}
          
          {refunds.length >= 2 && (
            <button 
              type="button"
              onClick={() => {
                setIsMerging(!isMerging);
                setMergeSelection([]);
              }}
              className={`flex items-center gap-2 px-6 py-3 font-bold rounded-2xl transition-all shadow-sm ${isMerging ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >
              <Merge size={18} />
              {isMerging ? 'Cancelar' : 'Unificar Deudas'}
            </button>
          )}
          <button 
            type="button"
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 dark:shadow-none active:scale-95"
          >
            <Plus size={18} />
            Nuevo Reembolso
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl w-fit border border-slate-200 dark:border-slate-700 shadow-inner">
        <button type="button" onClick={() => setFilter('open')} className={`px-6 py-2.5 text-xs font-black rounded-xl transition-all ${filter === 'open' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>PENDIENTES</button>
        <button type="button" onClick={() => setFilter('closed')} className={`px-6 py-2.5 text-xs font-black rounded-xl transition-all ${filter === 'closed' ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>COMPLETADOS</button>
        <button type="button" onClick={() => setFilter('all')} className={`px-6 py-2.5 text-xs font-black rounded-xl transition-all ${filter === 'all' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>TODOS</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredRefunds.map(r => (
          <div 
            key={r.id} 
            onClick={() => handleCardClick(r)}
            className={`bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 border transition-all relative overflow-hidden group flex flex-col duration-300 cursor-pointer ${
              isMerging && mergeSelection.includes(r.id) ? 'border-amber-500 ring-4 ring-amber-100 dark:ring-amber-900/30 scale-[1.02] shadow-xl' : 
              r.status === 'closed' ? 'border-slate-100 dark:border-slate-800 opacity-80 shadow-sm' : 'border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-md'
            }`}
          >
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${r.status === 'closed' ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600' : 'bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'}`}>
                  <Users size={22} />
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-slate-100 line-clamp-1">{r.name}</h4>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">{r.category} • {new Date(r.date).toLocaleDateString()}</p>
                </div>
              </div>
              <button 
                type="button"
                onClick={(e) => handleActionClick(e, () => deleteRefund(r.id))}
                className="p-2.5 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 transition-all"
              >
                <Trash2 size={18} />
              </button>
            </div>

            <div className={`rounded-3xl p-6 border transition-all space-y-4 ${r.status === 'closed' ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-800' : 'bg-blue-50/50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-900/50 shadow-sm'}`}>
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-bold mb-1">Pendiente</p>
                  <p className={`text-3xl font-black ${r.status === 'closed' ? 'text-slate-400 dark:text-slate-600 line-through' : 'text-blue-600 dark:text-blue-400'}`}>{r.pendingAmount.toLocaleString()}€</p>
                </div>
                {!isMerging && (
                    <div className="bg-white dark:bg-slate-800 p-2 rounded-full shadow-sm text-slate-400">
                        <ChevronDown size={16} />
                    </div>
                )}
              </div>
            </div>

            {r.status === 'open' && !isMerging && (
              <div className="mt-4">
                <button 
                  type="button"
                  onClick={(e) => handleActionClick(e, () => updateRefund({ ...r, status: 'closed', pendingAmount: 0 }))}
                  className="w-full flex items-center justify-center gap-2 p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-2xl text-xs font-bold hover:bg-emerald-50 dark:hover:bg-emerald-900/40 hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-200 dark:hover:border-emerald-800 transition-all active:scale-95"
                >
                  <CheckCircle2 size={16} className="text-slate-300 dark:text-slate-600" />
                  Marcar como cobrado
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {selectedRefund && (
        <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4" onClick={() => setSelectedRefundId(null)}>
            <div className="bg-white dark:bg-slate-900 rounded-[3rem] w-full max-w-md p-10 shadow-2xl animate-in zoom-in duration-300 border border-slate-100 dark:border-slate-800" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h3 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">{selectedRefund.name}</h3>
                        <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{selectedRefund.category} • Detalles</p>
                    </div>
                    <button onClick={() => setSelectedRefundId(null)} className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400"><X size={24} /></button>
                </div>

                <div className="space-y-4 mb-8">
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 flex justify-between items-center">
                        <span className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Mi Parte</span>
                        <span className="text-lg font-black text-slate-800 dark:text-white">{selectedRefund.paidByMe.toLocaleString()}€</span>
                    </div>
                    
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 p-5 rounded-2xl border border-emerald-100 dark:border-emerald-800/50 flex justify-between items-center">
                        <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Cobrado (Recibido)</span>
                        <span className="text-lg font-black text-emerald-700 dark:text-emerald-300">
                            {Math.max(0, (selectedRefund.totalAmount - selectedRefund.paidByMe) - selectedRefund.pendingAmount).toLocaleString()}€
                        </span>
                    </div>

                    <div className="bg-blue-50 dark:bg-blue-900/20 p-5 rounded-2xl border border-blue-100 dark:border-blue-800/50 flex justify-between items-center">
                        <span className="text-xs font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest">Total Operación</span>
                        <span className="text-lg font-black text-blue-700 dark:text-blue-300">{selectedRefund.totalAmount.toLocaleString()}€</span>
                    </div>
                </div>

                <div className="space-y-3">
                    <label className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        <AlignLeft size={14} /> Notas y Detalles
                    </label>
                    <textarea 
                        className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-4 text-sm font-medium text-slate-700 dark:text-slate-300 focus:border-blue-500 outline-none resize-none h-32 transition-colors"
                        placeholder="Escribe aquí quién te ha pagado, fechas o recordatorios..."
                        value={modalNotes}
                        onChange={(e) => setModalNotes(e.target.value)}
                    />
                </div>

                <button 
                    onClick={handleSaveNotes}
                    className="w-full mt-6 py-4 bg-slate-900 dark:bg-blue-600 text-white font-black rounded-2xl hover:bg-slate-800 dark:hover:bg-blue-700 transition-all active:scale-95 shadow-xl shadow-slate-200 dark:shadow-none"
                >
                    GUARDAR CAMBIOS
                </button>
            </div>
        </div>
      )}

      {isAdding && (
        <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] w-full max-w-md p-10 shadow-2xl animate-in zoom-in duration-300 border border-transparent dark:border-slate-800">
            <div className="flex justify-between items-center mb-8">
               <h3 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">Nuevo Reembolso</h3>
               <button type="button" onClick={() => setIsAdding(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full"><X size={20} className="text-slate-400" /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Concepto</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 outline-none font-medium text-slate-900 dark:text-white" placeholder="Cena..." required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Importe Total</label>
                  <input type="number" step="0.01" value={total} onChange={e => setTotal(e.target.value === '' ? '' : Number(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 font-bold outline-none text-slate-900 dark:text-white" required />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Tu parte</label>
                  <input type="number" step="0.01" value={myPart} onChange={e => setMyPart(e.target.value === '' ? '' : Number(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 font-bold outline-none text-slate-900 dark:text-white" required />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Categoría del presupuesto</label>
                <select 
                  value={category} 
                  onChange={e => setCategory(e.target.value)} 
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 font-bold outline-none text-slate-900 dark:text-white"
                  required
                >
                  <option value="" disabled>Selecciona una categoría</option>
                  {budgetExpenseCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                  {budgetExpenseCategories.length === 0 && <option value="" disabled>No hay categorías en el presupuesto</option>}
                </select>
                {budgetExpenseCategories.length === 0 && (
                  <p className="text-[10px] text-rose-500 mt-2 font-bold uppercase">⚠️ Debes crear categorías en la sección "Presupuesto" primero.</p>
                )}
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsAdding(false)} className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-2xl transition-colors">Cancelar</button>
                <button 
                  type="submit" 
                  disabled={budgetExpenseCategories.length === 0}
                  className="flex-1 py-4 bg-blue-600 text-white font-bold rounded-2xl active:scale-95 shadow-xl shadow-blue-100 dark:shadow-none disabled:opacity-50"
                >
                  Crear
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Refunds;
