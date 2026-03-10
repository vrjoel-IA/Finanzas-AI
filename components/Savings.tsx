
import React, { useState } from 'react';
import { useFinance } from '../App';
import { Plus, PiggyBank, TrendingUp, ArrowRightLeft, Percent, X, Edit2, Trash2, Check } from 'lucide-react';
import { Saving } from '../types';

const Savings: React.FC = () => {
  const { savings, currentDate, getSavingHistoricalBalance, addSaving, updateSaving, deleteSaving } = useFinance();
  const [isAdding, setIsAdding] = useState(false);
  const [editingSaving, setEditingSaving] = useState<Saving | null>(null);
  const [adjustingSaving, setAdjustingSaving] = useState<Saving | null>(null);
  const [adjustmentMode, setAdjustmentMode] = useState<'amount' | 'percent'>('amount');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Form State (shared for New/Edit)
  const [name, setName] = useState('');
  const [amountInput, setAmountInput] = useState<number | ''>('');
  const [targetInput, setTargetInput] = useState<number | ''>('');
  const [isInvestment, setIsInvestment] = useState(false);
  const [growthRateInput, setGrowthRateInput] = useState<number | ''>('');
  const [emoji, setEmoji] = useState('💰');

  // Adjustment Modal State
  const [adjValue, setAdjValue] = useState<number | ''>('');

  const resetForm = () => {
    setName('');
    setAmountInput('');
    setTargetInput('');
    setIsInvestment(false);
    setGrowthRateInput('');
    setEmoji('💰');
    setIsAdding(false);
    setEditingSaving(null);
  };

  const handleOpenEdit = (s: Saving) => {
    setName(s.name);
    setAmountInput(s.currentAmount);
    setTargetInput(s.targetAmount || '');
    setIsInvestment(s.isInvestment);
    setGrowthRateInput(s.growthRate || '');
    setEmoji(s.emoji || (s.isInvestment ? '📈' : '💰'));
    setEditingSaving(s);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalAmount = amountInput === '' ? 0 : amountInput;
    const finalTarget = targetInput === '' ? undefined : targetInput;
    const finalGrowth = isInvestment && growthRateInput !== '' ? growthRateInput : undefined;

    if (editingSaving) {
      updateSaving({
        ...editingSaving,
        name,
        currentAmount: finalAmount,
        targetAmount: finalTarget,
        isInvestment,
        growthRate: finalGrowth,
        emoji,
      });
    } else {
      addSaving({
        name,
        currentAmount: finalAmount,
        targetAmount: finalTarget,
        isInvestment,
        growthRate: finalGrowth,
        color: '#f59e0b',
        emoji,
      });
    }
    resetForm();
  };

  const applyAdjustment = () => {
    if (!adjustingSaving || adjValue === '') return;

    let newAmount = adjustingSaving.currentAmount;
    if (adjustmentMode === 'amount') {
      newAmount += adjValue;
    } else {
      newAmount = newAmount * (1 + adjValue / 100);
    }

    updateSaving({ ...adjustingSaving, currentAmount: Math.max(0, newAmount) });
    setAdjustingSaving(null);
    setAdjValue('');
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20 transition-colors">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-800 dark:text-white tracking-tight">Huchas e Inversiones</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium tracking-tight">Gestiona objetivos de ahorro. Mostrando estado a {currentDate}.</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 dark:shadow-none active:scale-95"
        >
          <Plus size={18} />
          Crear Hucha
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {savings.map(s => {
          const displayAmount = getSavingHistoricalBalance(s.id, currentDate);
          const progress = s.targetAmount ? Math.min((displayAmount / s.targetAmount) * 100, 100) : null;
          const isConfirming = confirmDeleteId === s.id;

          return (
            <div key={s.id} className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 border border-slate-100 dark:border-slate-800 shadow-sm relative group hover:shadow-md transition-all duration-300">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-inner dark:shadow-none ${s.isInvestment ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400' : 'bg-amber-50 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'} transition-colors`}>
                    {s.emoji || (s.isInvestment ? '📈' : '💰')}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 dark:text-slate-100">{s.name}</h4>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">
                      {s.isInvestment ? 'Inversión' : 'Ahorro Manual'}
                    </p>
                  </div>
                </div>
                <div className={`flex gap-1 transition-opacity ${isConfirming ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                  {!isConfirming ? (
                    <>
                      <button 
                        onClick={() => handleOpenEdit(s)}
                        className="p-2 text-slate-300 dark:text-slate-600 hover:text-blue-500 dark:hover:text-blue-400 transition-all"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        onClick={() => setConfirmDeleteId(s.id)}
                        className="p-2 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </>
                  ) : (
                    <div className="flex gap-1 items-center animate-in slide-in-from-right-2">
                       <button 
                        onClick={() => { deleteSaving(s.id); setConfirmDeleteId(null); }}
                        className="flex items-center gap-1 px-3 py-1.5 bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-700 transition-all"
                      >
                        <Check size={14} /> Confirmar
                      </button>
                      <button 
                        onClick={() => setConfirmDeleteId(null)}
                        className="p-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 transition-all"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black text-slate-900 dark:text-white">{displayAmount.toLocaleString('es-ES', { maximumFractionDigits: 2 })}€</span>
                  {s.growthRate && (
                    <span className="text-xs font-bold text-emerald-500 dark:text-emerald-400 flex items-center gap-0.5">
                      <TrendingUp size={12} /> {s.growthRate}%
                    </span>
                  )}
                </div>
                
                {progress !== null && (
                  <div className="mt-6">
                    <div className="flex justify-between text-[10px] font-black uppercase tracking-wider mb-2">
                      <span className="text-blue-600 dark:text-blue-400">{progress.toFixed(1)}% Completado</span>
                      <span className="text-slate-400 dark:text-slate-500">Meta: {s.targetAmount}€</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-600 dark:bg-blue-50 rounded-full transition-all duration-1000 ease-out" 
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => { setAdjustingSaving(s); setAdjustmentMode('amount'); }}
                  className="flex items-center justify-center gap-2 py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-700 transition-all border border-slate-100 dark:border-slate-700"
                >
                  <ArrowRightLeft size={16} className="text-blue-500 dark:text-blue-400" /> Ajustar Saldo
                </button>
                <button 
                  onClick={() => { setAdjustingSaving(s); setAdjustmentMode('percent'); }}
                  className="flex items-center justify-center gap-2 py-3 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-700 transition-all border border-slate-100 dark:border-slate-700"
                >
                  <Percent size={16} className="text-emerald-500 dark:text-emerald-400" /> Aplicar %
                </button>
              </div>
            </div>
          );
        })}
      </div>
      
      {adjustingSaving && (
        <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] w-full max-w-sm p-10 shadow-2xl animate-in fade-in zoom-in duration-300 border border-transparent dark:border-slate-800">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-xl font-black text-slate-800 dark:text-slate-100">
                {adjustmentMode === 'amount' ? 'Ajustar Cantidad' : 'Ajuste Porcentual'}
              </h3>
              <button onClick={() => { setAdjustingSaving(null); setAdjValue(''); }} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full">
                <X size={20} className="text-slate-400" />
              </button>
            </div>

            <div className="space-y-6">
              <div className="text-center">
                <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase mb-2">Hucha: {adjustingSaving.name}</p>
                <div className="flex items-center justify-center gap-3">
                  <input 
                    type="number" 
                    step="0.01"
                    value={adjValue} 
                    onChange={e => setAdjValue(e.target.value === '' ? '' : Number(e.target.value))}
                    autoFocus
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-6 text-center text-4xl font-black outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-900 dark:text-white"
                    placeholder="0"
                  />
                  <span className="text-2xl font-black text-slate-400 dark:text-slate-500">
                    {adjustmentMode === 'amount' ? '€' : '%'}
                  </span>
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => { setAdjustingSaving(null); setAdjValue(''); }}
                  className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-2xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={applyAdjustment}
                  disabled={adjValue === ''}
                  className="flex-1 py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 shadow-xl shadow-blue-100 dark:shadow-none transition-all active:scale-95 disabled:opacity-50"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {(isAdding || editingSaving) && (
        <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] w-full max-w-md p-10 shadow-2xl animate-in fade-in zoom-in duration-300 overflow-y-auto max-h-[90vh] border border-transparent dark:border-slate-800">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100">{editingSaving ? 'Editar Hucha' : 'Nueva Meta'}</h3>
              <button onClick={resetForm} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full">
                <X size={20} className="text-slate-400" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Nombre del objetivo</label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={e => setName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100" 
                  placeholder="Ej: Fondo para el Coche" 
                  required 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Monto Actual</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={amountInput} 
                    onChange={e => setAmountInput(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 font-bold outline-none text-slate-900 dark:text-white" 
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Meta Final</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={targetInput} 
                    onChange={e => setTargetInput(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 font-bold outline-none text-slate-900 dark:text-white" 
                    placeholder="Opcional"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Emoticono</label>
                <input 
                  type="text" 
                  value={emoji} 
                  onChange={e => setEmoji(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 text-center text-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-900 dark:text-white" 
                  placeholder="💰"
                />
              </div>

              <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" onClick={() => setIsInvestment(!isInvestment)}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isInvestment ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-400 shadow-sm'}`}>
                  {isInvestment ? <TrendingUp size={20} /> : <PiggyBank size={20} />}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">¿Es una inversión?</p>
                  <p className="text-[10px] text-slate-400 font-medium">Habilita seguimiento de rendimiento.</p>
                </div>
                <div className={`w-6 h-6 rounded-full border-2 transition-all flex items-center justify-center ${isInvestment ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300 dark:border-slate-600'}`}>
                  {isInvestment && <div className="w-2 h-2 bg-white rounded-full"></div>}
                </div>
              </div>

              {isInvestment && (
                <div className="animate-in slide-in-from-top-2 duration-200">
                  <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Rendimiento Estimado Anual (%)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={growthRateInput} 
                    onChange={e => setGrowthRateInput(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 font-bold outline-none text-slate-900 dark:text-white" 
                    placeholder="Opcional"
                  />
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button 
                  type="button" 
                  onClick={resetForm} 
                  className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-2xl transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="flex-1 py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 shadow-xl shadow-blue-100 dark:shadow-none transition-all active:scale-95"
                >
                  {editingSaving ? 'Guardar Cambios' : 'Crear Hucha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Savings;
