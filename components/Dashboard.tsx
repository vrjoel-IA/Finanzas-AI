
import React, { useMemo, useState } from 'react';
import { useFinance } from '../App';
import { useNavigate } from 'react-router-dom';
import { 
  TrendingUp, 
  TrendingDown, 
  Target, 
  PiggyBank,
  Wallet,
  CheckCircle2,
  Circle,
  ChevronUp,
  ChevronDown,
  Settings2,
  ChevronRight,
  Sparkles,
  Loader2,
  ShoppingBag,
  AlertCircle,
  History,
  X
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { generateAIChallenges } from '../services/geminiService';
import { Budget, Transaction } from '../types';
import { ICON_MAP } from '../constants';

const Dashboard: React.FC = () => {
  const { 
    accounts, 
    savings, 
    transactions, 
    challenges, 
    budgets,
    currentDate,
    dashboardLayout,
    updateLayout,
    setChallenges,
    getAccountHistoricalBalance,
    getSavingHistoricalBalance,
    getNetWorthHistorical, 
    viewMode,
    theme
  } = useFinance();

  const navigate = useNavigate();
  const [isEditMode, setIsEditMode] = useState(false);
  const [chartFilter, setChartFilter] = useState<'6m' | '12m'>('12m');
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [isGeneratingChallenges, setIsGeneratingChallenges] = useState(false);
  const [selectedBudgetForDetails, setSelectedBudgetForDetails] = useState<Budget | null>(null); 
  const [isBudgetsExpanded, setIsBudgetsExpanded] = useState(false); 

  const isSavingTx = (t: Transaction) => t.category === 'Ahorro' || t.category === 'Ahorros' || !!t.savingId;
  const isTransferTx = (t: Transaction) => t.category === 'Traspaso' || t.category === 'Transferencia';

  const metrics = useMemo(() => {
    let prevDateStr: string;
    if (viewMode === 'year') {
      prevDateStr = (parseInt(currentDate) - 1).toString();
    } else {
      const parts = currentDate.split('-').map(Number);
      const date = new Date(parts[0], parts[1] - 2, 1);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      prevDateStr = `${y}-${m}`;
    }

    const pastLiquidBalance = accounts.reduce((sum, acc) => sum + getAccountHistoricalBalance(acc.id, prevDateStr), 0);
    const monthTx = transactions.filter(t => t.date.startsWith(currentDate));
    
    // 1. Ingresos Estándar (Nómina, ventas, etc) - Excluyendo huchas y traspasos
    const baseIncome = monthTx
      .filter(t => t.type === 'income' && !t.refundId && !isSavingTx(t) && !isTransferTx(t))
      .reduce((sum, t) => sum + t.amount, 0);
    
    // 2. Reembolsos recuperados
    const refundRecoveries = monthTx
      .filter(t => t.type === 'income' && t.refundId)
      .reduce((sum, t) => sum + t.amount, 0);

    // 3. Gastos Estándar - Excluyendo huchas y traspasos
    const baseSpending = monthTx
      .filter(t => t.type === 'expense' && !isSavingTx(t) && !isTransferTx(t))
      .reduce((sum, t) => sum + t.amount, 0);
    
    // 4. MOVIMIENTOS DE AHORRO (Algoritmo solicitado)
    // Dinero que ENTRA a cuenta desde ahorro -> Se suma a ingresos (Aumenta Liquidez)
    const savingWithdrawals = monthTx
      .filter(t => t.type === 'income' && isSavingTx(t))
      .reduce((sum, t) => sum + t.amount, 0);
    
    // Dinero que SALE de cuenta hacia ahorro -> Se resta del resultado (Disminuye Liquidez)
    const savingDeposits = monthTx
      .filter(t => t.type === 'expense' && isSavingTx(t))
      .reduce((sum, t) => sum + t.amount, 0);

    // Cálculos de Liquidez
    const totalInflow = baseIncome + savingWithdrawals;
    const netSpending = Math.max(0, baseSpending - refundRecoveries);
    
    // Resultado Líquido = Ingresos Reales + Retiradas Ahorro - (Gastos Netos + Aportaciones Ahorro)
    const monthResult = totalInflow - netSpending - savingDeposits;
    
    const liquidity = pastLiquidBalance + monthResult;
    const totalSavingsAccumulated = savings.reduce((sum, s) => sum + getSavingHistoricalBalance(s.id, currentDate), 0);
    const netWorth = liquidity + totalSavingsAccumulated;

    return { 
      baseIncome, 
      expense: netSpending, 
      savingDeposits, 
      savingWithdrawals,
      monthResult, 
      pastLiquidBalance, 
      liquidity, 
      totalSavingsAccumulated, 
      netWorth, 
      refundRecoveries,
      totalInflow
    };
  }, [transactions, currentDate, accounts, savings, getAccountHistoricalBalance, getSavingHistoricalBalance, viewMode]);

  const evaluatedChallenges = useMemo(() => {
    return challenges.map(ch => {
      const monthTx = transactions.filter(t => t.date.startsWith(currentDate));
      let isCompleted = false;
      if (ch.type === 'spending_limit') {
        const spent = monthTx.filter(t => t.type === 'expense' && t.category === ch.category).reduce((sum, t) => sum + t.amount, 0);
        isCompleted = spent <= ch.target && spent > 0;
      } else if (ch.type === 'savings_goal') {
        isCompleted = metrics.totalSavingsAccumulated >= ch.target;
      } else if (ch.type === 'income_target') {
        isCompleted = metrics.baseIncome >= ch.target;
      }
      return { ...ch, completed: isCompleted || ch.completed };
    });
  }, [challenges, transactions, currentDate, metrics]);

  const chartData = useMemo(() => {
    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const limit = chartFilter === '6m' ? 6 : 12;
    const currentYear = parseInt(currentDate.substring(0, 4));
    const currentMonthIndex = viewMode === 'month' ? parseInt(currentDate.substring(5, 7)) - 1 : 11;
    const data = Array.from({ length: limit }).map((_, i) => {
        const date = new Date(currentYear, currentMonthIndex, 1);
        date.setMonth(date.getMonth() - (limit - 1 - i));
        const displayMonthIndex = date.getMonth();
        const displayYear = date.getFullYear();
        const dateStrForCalculation = viewMode === 'year' ? displayYear.toString() : `${displayYear}-${String(displayMonthIndex + 1).padStart(2, '0')}`;
        const patrimonio = getNetWorthHistorical(dateStrForCalculation);
        return { name: monthNames[displayMonthIndex], fullLabel: `${monthNames[displayMonthIndex]} ${displayYear}`, patrimonio };
    });
    return data;
  }, [getNetWorthHistorical, chartFilter, currentDate, viewMode]);

  const handleGenerateChallenges = async () => {
    setIsGeneratingChallenges(true);
    try {
      const budgetsInfo = budgets.map(b => {
        const calculatedSpent = transactions.filter(t => t.date.startsWith(currentDate) && t.category === b.category).reduce((sum, t) => {
            if (b.type === 'expense') {
              if (t.type === 'expense') return sum + t.amount;
              if (t.type === 'income' && t.refundId) return sum - t.amount;
            }
            if (b.type === 'income' && t.type === 'income') return sum + t.amount;
            return sum;
          }, 0);
        return `${b.category}: ${calculatedSpent}/${b.limit}€`;
      }).join(", ");
      const context = `Presupuestos: ${budgetsInfo}. Patrimonio: ${metrics.netWorth}€. Ahorros: ${metrics.totalSavingsAccumulated}€.`;
      const newChallenges = await generateAIChallenges(context);
      setChallenges(newChallenges);
    } catch (error) { console.error("Error generating challenges:", error); } finally { setIsGeneratingChallenges(false); }
  };

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    const newLayout = [...dashboardLayout];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newLayout.length) return;
    [newLayout[index], newLayout[targetIndex]] = [newLayout[targetIndex], newLayout[index]];
    updateLayout(newLayout);
  };

  const budgetsWithCalculatedSpent = useMemo(() => {
    return budgets.map(b => {
      const calculatedSpent = transactions.filter(t => t.date.startsWith(currentDate) && t.category === b.category).reduce((sum, t) => {
          if (isTransferTx(t)) return sum; 
          if (b.type === 'expense') {
            if (t.type === 'expense') return sum + t.amount;
            if (t.type === 'income' && t.refundId) return sum - t.amount;
          }
          if (b.type === 'income') {
            if (t.type === 'income' && !t.refundId) return sum + t.amount;
          }
          return sum;
        }, 0);
      const totalRefundedForCategory = transactions.filter(t => t.date.startsWith(currentDate) && t.category === b.category && t.type === 'income' && !!t.refundId).reduce((sum, t) => sum + t.amount, 0);
      return { ...b, spent: calculatedSpent, totalRefunded: totalRefundedForCategory };
    });
  }, [budgets, transactions, currentDate]);

  const renderBlock = (key: string, index: number) => {
    const moveControls = isEditMode && (
      <div className="absolute top-4 right-4 flex gap-1 z-20">
        <button onClick={(e) => { e.stopPropagation(); moveBlock(index, 'up'); }} className="p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-95" disabled={index === 0}><ChevronUp size={16} className="text-slate-600 dark:text-slate-400" /></button>
        <button onClick={(e) => { e.stopPropagation(); moveBlock(index, 'down'); }} className="p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-95" disabled={index === dashboardLayout.length - 1}><ChevronDown size={16} className="text-slate-600 dark:text-slate-400" /></button>
      </div>
    );

    switch (key) {
      case 'balance':
        return (
          <div key={key} className="relative bg-[#2563eb] dark:bg-blue-600 rounded-[2.5rem] p-8 md:p-10 text-white shadow-2xl shadow-blue-200/50 dark:shadow-blue-900/20 overflow-hidden transition-colors duration-300">
            {moveControls}
            <div className="relative z-10 flex flex-col">
              <div className="flex justify-between items-start mb-10">
                <div><p className="text-blue-100 text-[9px] font-black uppercase tracking-[0.2em] mb-2 opacity-80">Patrimonio Neto en {currentDate}</p><h2 className="text-4xl md:text-5xl font-black tracking-tight">{metrics.netWorth.toLocaleString()}€</h2></div>
                <button onClick={() => setShowBreakdown(!showBreakdown)} className={`px-5 py-3 rounded-2xl flex items-center gap-2 text-xs font-black transition-all shadow-lg bg-white/20 backdrop-blur-md hover:bg-white/30 active:scale-95`}>{metrics.monthResult >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}{metrics.monthResult >= 0 ? '+' : ''}{metrics.monthResult.toLocaleString()}€ este mes<ChevronDown size={14} className={`transition-transform duration-300 ${showBreakdown ? 'rotate-180' : ''}`} /></button>
              </div>
              {showBreakdown && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 animate-in slide-in-from-top-4 duration-300">
                  <div className="p-5 bg-emerald-500/30 backdrop-blur-md rounded-[1.8rem] border border-white/10 flex flex-col justify-between">
                    <p className="text-[9px] font-black uppercase tracking-wider text-emerald-100">Ingresos</p>
                    <p className="text-2xl font-black">{metrics.totalInflow.toLocaleString()}€</p>
                    <p className="text-[8px] opacity-70 mt-1 font-bold">Base: {metrics.baseIncome}€ | Retiradas Hucha: {metrics.savingWithdrawals}€</p>
                  </div>
                  <div className="p-5 bg-rose-500/30 backdrop-blur-md rounded-[1.8rem] border border-white/10 flex flex-col justify-between">
                    <p className="text-[9px] font-black uppercase tracking-wider text-rose-100">Gasto Neto</p>
                    <p className="text-2xl font-black">{metrics.expense.toLocaleString()}€</p>
                    {metrics.refundRecoveries > 0 && (<p className="text-[9px] font-bold text-rose-200 opacity-80 mt-1">(-{metrics.refundRecoveries.toLocaleString()}€ reembolsos)</p>)}
                  </div>
                  <div className="p-5 bg-amber-500/30 backdrop-blur-md rounded-[1.8rem] border border-white/10 flex flex-col justify-between">
                    <p className="text-[9px] font-black uppercase tracking-wider text-amber-100">Ahorro</p>
                    <p className="text-2xl font-black">{metrics.savingDeposits.toLocaleString()}€</p>
                    <p className="text-[8px] opacity-70 mt-1 font-bold">Dinero movido a huchas (resta de liquidez)</p>
                  </div>
                </div>
              )}
              <div className="h-px bg-white/15 w-full mb-8"></div>
              <div className="grid grid-cols-3 gap-8">
                <div><p className="text-[9px] text-blue-200 font-black uppercase tracking-[0.15em] mb-3 opacity-90">Saldo Anterior</p><p className="text-xl md:text-2xl font-black">{metrics.pastLiquidBalance.toLocaleString()}€</p></div>
                <div><p className="text-[9px] text-blue-200 font-black uppercase tracking-[0.15em] mb-3 opacity-90">Resultado Mes</p><p className="text-xl md:text-2xl font-black">{metrics.monthResult.toLocaleString()}€</p></div>
                <div><p className="text-[9px] text-blue-200 font-black uppercase tracking-[0.15em] mb-3 opacity-90">Liquidez Actual</p><p className="text-xl md:text-2xl font-black">{metrics.liquidity.toLocaleString()}€</p></div>
              </div>
            </div>
          </div>
        );
      case 'challenges':
        return (
          <div key={key} className="relative bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm h-full hover:shadow-md transition-all duration-300">
            {moveControls}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2"><div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-xl flex items-center justify-center transition-colors"><Target size={20} /></div><h3 className="font-bold text-slate-800 dark:text-slate-100">Retos AI Aura</h3></div>
              <button onClick={handleGenerateChallenges} disabled={isGeneratingChallenges} className="p-2.5 bg-blue-600 text-white rounded-xl transition-all disabled:opacity-50 hover:bg-blue-700 shadow-md shadow-blue-100 dark:shadow-none">{isGeneratingChallenges ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}</button>
            </div>
            <div className="space-y-3">{evaluatedChallenges.map(ch => (<div key={ch.id} className={`p-4 rounded-2xl border flex items-center gap-3 transition-all ${ch.completed ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800/50' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800'}`}>{ch.completed ? <CheckCircle2 className="text-emerald-500" size={20}/> : <Circle className="text-slate-300 dark:text-slate-600" size={20}/>}<div className="flex-1"><p className={`text-sm font-bold ${ch.completed ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-300'}`}>{ch.title}</p><p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Objetivo: {ch.target}€</p></div></div>))}{evaluatedChallenges.length === 0 && (<p className="text-slate-400 dark:text-slate-500 text-xs text-center py-4 italic">Pulsa en el destello para que Aura te proponga retos.</p>)}</div>
          </div>
        );
      case 'savings':
        return (
          <div key={key} className="relative bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm h-full hover:shadow-md transition-all duration-300">
            {moveControls}
            <div className="flex items-center gap-2 mb-6">
              <div className="w-10 h-10 bg-amber-50 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 rounded-xl flex items-center justify-center transition-colors"><PiggyBank size={20} /></div>
              <h3 onClick={() => navigate('/savings')} className="font-bold text-slate-800 dark:text-slate-100 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline underline-offset-4 decoration-2 transition-all">Ahorro en {currentDate}</h3>
            </div>
            <div className="text-center py-6"><p className="text-4xl font-black text-slate-900 dark:text-white">{metrics.totalSavingsAccumulated.toLocaleString()}€</p><p className="text-xs text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-2">Capital acumulado histórico</p></div>
            <div className="grid grid-cols-2 gap-2 mt-4">{savings.slice(0, 4).map(s => (<div key={s.id} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 transition-colors"><p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold truncate uppercase tracking-tighter">{s.name}</p><p className="text-xs font-black text-slate-700 dark:text-slate-200">{getSavingHistoricalBalance(s.id, currentDate).toLocaleString()}€</p></div>))}</div>
          </div>
        );
      case 'chart':
        return (
          <div key={key} className="relative bg-white dark:bg-slate-900 p-10 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm transition-all duration-300">
            {moveControls}
            <div className="flex items-center justify-between mb-8"><h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><TrendingUp size={20} className="text-emerald-500" /> Evolución del Patrimonio</h3><div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl"><button onClick={() => setChartFilter('6m')} className={`px-4 py-1.5 text-[10px] font-bold rounded-lg transition-all ${chartFilter === '6m' ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}>6 M</button><button onClick={() => setChartFilter('12m')} className={`px-4 py-1.5 text-[10px] font-bold rounded-lg transition-all ${chartFilter === '12m' ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}>12 M</button></div></div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs><linearGradient id="colorPat" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#1e293b' : '#f1f5f9'} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: theme === 'dark' ? '#64748b' : '#94a3b8'}} />
                  <YAxis hide />
                  <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', backgroundColor: theme === 'dark' ? '#0f172a' : '#fff', color: theme === 'dark' ? '#f1f5f9' : '#000' }} itemStyle={{ color: theme === 'dark' ? '#3b82f6' : '#2563eb' }} formatter={(value: any, name: string, props: any) => [`${value.toLocaleString()}€`, props.payload.fullLabel || 'Patrimonio']}/>
                  <Area type="monotone" dataKey="patrimonio" stroke="#3b82f6" strokeWidth={3} fill="url(#colorPat)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      case 'accounts':
        return (
          <div key={key} className="relative bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-all duration-300">
            {moveControls}
            <div className="flex items-center gap-2 mb-6">
              <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center justify-center transition-colors"><Wallet size={20} /></div>
              <h3 onClick={() => navigate('/accounts')} className="font-bold text-slate-800 dark:text-slate-100 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline underline-offset-4 decoration-2 transition-all">Cuentas en {currentDate}</h3>
            </div>
            <div className="space-y-4">{accounts.map(acc => (<div key={acc.id} className="flex justify-between items-center p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 transition-colors"><div className="flex items-center gap-3"><span className="text-xl">{acc.emoji || '🏦'}</span><span className="font-bold text-slate-700 dark:text-slate-300 text-sm">{acc.name}</span></div><span className="font-black text-slate-900 dark:text-white">{getAccountHistoricalBalance(acc.id, currentDate).toLocaleString()}€</span></div>))}</div>
          </div>
        );
      case 'budget':
        const displayedBudgets = isBudgetsExpanded ? budgetsWithCalculatedSpent : budgetsWithCalculatedSpent.slice(0, 4);
        return (
          <div key={key} className="relative bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm h-full hover:shadow-md transition-all duration-300">
            {moveControls}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-purple-50 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 rounded-xl flex items-center justify-center transition-colors"><ShoppingBag size={20} /></div>
                <h3 onClick={() => navigate('/budget')} className="font-bold text-slate-800 dark:text-slate-100 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline underline-offset-4 decoration-2 transition-all">Presupuestos Mes</h3>
              </div>
              {budgets.length > 4 && (<button onClick={() => setIsBudgetsExpanded(!isBudgetsExpanded)} className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all shadow-sm"><ChevronDown className={`transition-transform duration-300 ${isBudgetsExpanded ? 'rotate-180' : ''}`} size={18} /></button>)}
            </div>
            <div className="space-y-6">
              {displayedBudgets.map(b => {
                const progress = b.limit > 0 ? Math.min((b.spent / b.limit) * 100, 100) : 0;
                const isOverBudget = b.type === 'expense' && b.spent > b.limit;
                return (
                  <div key={b.id} onClick={() => setSelectedBudgetForDetails(b)} className="cursor-pointer group space-y-1.5">
                    <div className="flex justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider"><span>{b.category}</span><span style={{ color: isOverBudget ? '#f43f5e' : b.color }}>{b.spent.toLocaleString('es-ES')}€ / {b.limit.toLocaleString('es-ES')}€ ({Math.round(progress)}%)</span></div>
                    <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden"><div className={`h-full transition-all duration-700`} style={{ width: `${progress}%`, backgroundColor: isOverBudget ? '#f43f5e' : b.color || '#3b82f6' }}></div></div>
                    {b.totalRefunded > 0 && (<p className="text-[9px] font-black flex items-center gap-1 mt-1 transition-all" style={{ color: b.color }}><ChevronRight size={10} className="shrink-0" /> Reembolsado: +{b.totalRefunded.toLocaleString()}€ (Ahorro en gasto neto)</p>)}
                  </div>
                );
              })}{budgets.length === 0 && <p className="text-xs text-slate-400 dark:text-slate-500 italic text-center py-4">Sin límites definidos.</p>}
            </div>
          </div>
        );
      default: return null;
    }
  };

  const budgetTransactions = useMemo(() => {
    if (!selectedBudgetForDetails) return [];
    return transactions.filter(t => t.category === selectedBudgetForDetails.category && t.date.startsWith(currentDate)).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [selectedBudgetForDetails, transactions, currentDate]);

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2">
        <div><h2 className="text-3xl font-black text-slate-800 dark:text-white tracking-tight">Dashboard</h2><p className="text-slate-500 dark:text-slate-400 font-medium tracking-tight transition-colors">Análisis de {currentDate}. Ahorro y liquidez sincronizados.</p></div>
        <button onClick={() => setIsEditMode(!isEditMode)} className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-sm transition-all shadow-sm ${isEditMode ? 'bg-blue-600 text-white shadow-xl shadow-blue-200 dark:shadow-blue-900/40' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}><Settings2 size={18}/> {isEditMode ? 'Guardar Cambios' : 'Personalizar Diseño'}</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-min">{dashboardLayout.map((key, idx) => { const isFullWidth = key === 'balance' || key === 'chart'; return (<div key={key} className={`${isFullWidth ? 'lg:col-span-2' : 'lg:col-span-1'} transition-all duration-300`}>{renderBlock(key, idx)}</div>); })}</div>
      {selectedBudgetForDetails && (
        <div className="fixed inset-0 bg-slate-900/90 z-[60] flex items-center justify-center p-4" onClick={() => setSelectedBudgetForDetails(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-[3rem] w-full max-w-lg p-8 md:p-10 shadow-2xl animate-in fade-in zoom-in duration-300 border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-8 flex-shrink-0"><div className="flex items-center gap-5"><div className={`w-16 h-16 rounded-[1.5rem] flex items-center justify-center shadow-lg dark:shadow-none transition-colors`} style={{ backgroundColor: `${selectedBudgetForDetails.color}${theme === 'dark' ? '30' : '15'}`, color: selectedBudgetForDetails.color }}>{ICON_MAP[selectedBudgetForDetails.icon] ? (React.cloneElement(ICON_MAP[selectedBudgetForDetails.icon] as React.ReactElement, { size: 28 })) : (<span className="text-3xl">{selectedBudgetForDetails.icon || <ShoppingBag size={28} />}</span>)}</div><div><h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{selectedBudgetForDetails.category}</h3><p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Movimientos de {currentDate}</p></div></div><button onClick={() => setSelectedBudgetForDetails(null)} className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400"><X size={24} /></button></div>
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-3xl p-6 mb-8 border border-slate-100 dark:border-slate-800 flex-shrink-0 transition-colors"><div className="flex justify-between items-end mb-4"><div><p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1">Total acumulado</p><p className="text-3xl font-black text-slate-900 dark:text-white transition-colors">{selectedBudgetForDetails.spent.toLocaleString()}€</p></div><div className="text-right"><p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1">Límite</p><p className="text-lg font-bold text-slate-600 dark:text-slate-400 transition-colors">{selectedBudgetForDetails.limit.toLocaleString()}€</p></div></div><div className="w-full h-3 bg-white dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700"><div className={`h-full rounded-full transition-all duration-1000`} style={{ width: `${Math.min((selectedBudgetForDetails.spent / selectedBudgetForDetails.limit) * 100, 100)}%`, backgroundColor: (selectedBudgetForDetails.type === 'expense' && selectedBudgetForDetails.spent > selectedBudgetForDetails.limit) ? '#f43f5e' : selectedBudgetForDetails.color }}></div></div></div>
            <div className="flex items-center gap-2 mb-4 flex-shrink-0"><History size={16} className="text-slate-400 dark:text-slate-600" /><h4 className="text-xs font-black text-slate-500 dark:text-slate-500 uppercase tracking-widest">Historial Reciente</h4></div>
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-2">{budgetTransactions.length > 0 ? budgetTransactions.map(tx => (<div key={tx.id} className="flex justify-between items-center p-4 bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-2xl hover:border-blue-200 dark:hover:border-blue-800 transition-colors duration-300"><div className="flex items-center gap-4"><div className="text-center bg-slate-50 dark:bg-slate-900 w-10 py-1.5 rounded-xl border border-slate-100 dark:border-slate-700 transition-colors"><p className="text-[8px] font-black text-slate-400 dark:text-slate-600 uppercase">{new Date(tx.date).toLocaleDateString('es-ES', { month: 'short' })}</p><p className="text-xs font-black text-slate-700 dark:text-slate-300 transition-colors">{new Date(tx.date).getDate()}</p></div><div><p className="text-sm font-bold text-slate-800 dark:text-slate-200 line-clamp-1 transition-colors">{tx.description}</p><p className="text-[10px] font-medium text-slate-400 dark:text-slate-500">{accounts.find(a => a.id === tx.accountId)?.name || 'Cuenta'}</p></div></div><div className="text-right"><p className={`font-black ${tx.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'} transition-colors`}>{tx.type === 'income' ? '+' : '-'}{tx.amount.toLocaleString()}€</p></div></div>)) : (<div className="text-center py-12 bg-slate-50 dark:bg-slate-800/30 rounded-[2rem] border-2 border-dashed border-slate-200 dark:border-slate-700 transition-colors"><AlertCircle size={32} className="mx-auto text-slate-300 dark:text-slate-700 mb-3" /><p className="text-xs font-bold text-slate-400 dark:text-slate-600 uppercase tracking-widest">No hay transacciones aún</p></div>)}</div>
            <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 flex-shrink-0"><button onClick={() => setSelectedBudgetForDetails(null)} className="w-full py-4 bg-slate-900 dark:bg-blue-600 text-white font-black rounded-2xl hover:bg-slate-800 dark:hover:bg-blue-700 transition-all active:scale-[0.98]">ENTENDIDO</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
