
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
  X,
  PieChart as PieChartIcon,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  SlidersHorizontal
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend
} from 'recharts';
import { generateAIChallenges } from '../services/geminiService';
import { Budget, Transaction } from '../types';
import { ICON_MAP, CATEGORIES, INCOME_CATEGORIES, BUDGET_PRESET_COLORS } from '../constants';
import { aggregatePeriod, monthSeries, topExpenseCategories, categorySpent } from '../services/periodIndex';
import { previousPeriod, isMonthKey, monthRange, sameMonthPreviousYear } from '../services/periods';
import { mergeLayout } from '../services/dashboardBlocks';

const Dashboard: React.FC = () => {
  const { 
    accounts, 
    savings, 
    transactions, 
    challenges, 
    currentDate,
    getEffectiveBudgets,
    dashboardLayout,
    updateLayout,
    setChallenges,
    getAccountHistoricalBalance,
    getSavingHistoricalBalance,
    getNetWorthHistorical, 
    viewIndex,
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
  const [budgetTab, setBudgetTab] = useState<'expense' | 'income'>('expense');
  const [trendMetric, setTrendMetric] = useState<'flow' | 'savings' | 'category'>('flow');
  const [trendRange, setTrendRange] = useState<6 | 12 | 24>(12);
  const [trendCategories, setTrendCategories] = useState<string[]>([]);
  const [compareLastYear, setCompareLastYear] = useState(false); 

  const budgets = useMemo(() => getEffectiveBudgets(currentDate), [getEffectiveBudgets, currentDate]);

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
    const newLayout = [...layout];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newLayout.length) return;
    [newLayout[index], newLayout[targetIndex]] = [newLayout[targetIndex], newLayout[index]];
    updateLayout(newLayout);
  };

  // Gasto por categoria desde el indice compartido. Antes este calculo estaba
  // triplicado en este mismo fichero con exclusiones distintas en cada copia,
  // asi que el anillo, los retos y el widget podian no cuadrar entre si.
  const budgetsWithCalculatedSpent = useMemo(() => {
    const agg = aggregatePeriod(viewIndex, currentDate);
    return budgets.map(b => {
      const type = (b.type || 'expense') as 'income' | 'expense';
      const flow = agg.byCategory[b.category];
      return {
        ...b,
        spent: categorySpent(agg, b.category, type),
        totalRefunded: flow ? flow.refunded : 0,
      };
    });
  }, [budgets, currentDate, viewIndex]);

  // El layout guardado de un usuario antiguo no conoce los bloques nuevos. Se
  // fusiona en LECTURA: escribirlo al arrancar subiria el estado entero a la nube.
  const layout = useMemo(() => mergeLayout(dashboardLayout), [dashboardLayout]);

  const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const monthLabel = (key: string) => MONTH_SHORT[Number(key.slice(5, 7)) - 1] + " " + key.slice(2, 4);

  // Color estable por categoria: el del presupuesto si existe, si no el del
  // catalogo, y como ultimo recurso uno de la paleta segun el nombre.
  const colorForCategory = useMemo(() => {
    const table: Record<string, string> = {};
    [...CATEGORIES, ...INCOME_CATEGORIES].forEach(c => { table[c.name] = c.color; });
    budgets.forEach(b => { if (b.color) table[b.category] = b.color; });
    return (name: string) => {
      if (table[name]) return table[name];
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 997;
      return BUDGET_PRESET_COLORS[hash % BUDGET_PRESET_COLORS.length];
    };
  }, [budgets]);

  // Comparativa con el periodo anterior. Usa el indice compartido; el bloque de
  // patrimonio sigue con su propio calculo, intacto.
  const comparison = useMemo(() => {
    const now = aggregatePeriod(viewIndex, currentDate);
    const before = aggregatePeriod(viewIndex, previousPeriod(currentDate));
    const row = (label: string, current: number, previous: number, lowerIsBetter: boolean) => {
      const delta = current - previous;
      const hasBase = Math.abs(previous) > 0.005;
      return {
        label,
        current,
        previous,
        delta,
        percent: hasBase ? (delta / Math.abs(previous)) * 100 : null,
        lowerIsBetter,
      };
    };
    return {
      period: previousPeriod(currentDate),
      rows: [
        row('Ingresos', now.baseIncome, before.baseIncome, false),
        row('Gastos', Math.max(0, now.netExpense), Math.max(0, before.netExpense), true),
        row('Ahorro', now.netResult, before.netResult, false),
      ],
    };
  }, [viewIndex, currentDate]);

  // Anillo de gasto: las cinco categorias mayores y el resto agrupado.
  const categoryBreakdown = useMemo(() => {
    const agg = aggregatePeriod(viewIndex, currentDate);
    const all = topExpenseCategories(agg, 0);
    const total = all.reduce((sum, row) => sum + row.amount, 0);
    const top = all.slice(0, 5);
    const rest = all.slice(5).reduce((sum, row) => sum + row.amount, 0);
    const slices = top.map(row => ({ name: row.category, value: row.amount, color: colorForCategory(row.category) }));
    if (rest > 0) slices.push({ name: 'Otros', value: rest, color: '#94a3b8' });
    return { slices, total, count: all.length };
  }, [viewIndex, currentDate, colorForCategory]);

  const expenseCategoryNames = useMemo(() => {
    const agg = aggregatePeriod(viewIndex, currentDate);
    return topExpenseCategories(agg, 8).map(row => row.category);
  }, [viewIndex, currentDate]);

  // Serie temporal filtrable. A diferencia del grafico de patrimonio, el eje es
  // SIEMPRE mensual, tambien en vista anual: ahi estaba el fallo de la linea plana.
  const trendData = useMemo(() => {
    const end = isMonthKey(currentDate) ? currentDate : currentDate.slice(0, 4) + '-12';
    return monthRange(end, trendRange).map(key => {
      const agg = aggregatePeriod(viewIndex, key);
      const point: Record<string, any> = {
        key,
        name: monthLabel(key),
        ingresos: Math.round(agg.baseIncome),
        gastos: Math.round(Math.max(0, agg.netExpense)),
        ahorro: Math.round(agg.netResult),
      };
      if (compareLastYear) {
        const lastYearKey = sameMonthPreviousYear(key);
        const prev = lastYearKey ? aggregatePeriod(viewIndex, lastYearKey) : null;
        point.ingresosAnterior = prev ? Math.round(prev.baseIncome) : 0;
        point.gastosAnterior = prev ? Math.round(Math.max(0, prev.netExpense)) : 0;
        point.ahorroAnterior = prev ? Math.round(prev.netResult) : 0;
      }
      trendCategories.forEach(category => {
        point[category] = Math.round(categorySpent(agg, category, 'expense'));
      });
      return point;
    });
  }, [viewIndex, currentDate, trendRange, trendCategories, compareLastYear]);

  const toggleTrendCategory = (category: string) => {
    setTrendCategories(prev =>
      prev.indexOf(category) === -1 ? [...prev, category] : prev.filter(c => c !== category),
    );
  };

  const renderBlock = (key: string, index: number) => {
    const moveControls = isEditMode && (
      <div className="absolute top-4 right-4 flex gap-1 z-20">
        <button onClick={(e) => { e.stopPropagation(); moveBlock(index, 'up'); }} className="p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-95" disabled={index === 0}><ChevronUp size={16} className="text-slate-600 dark:text-slate-400" /></button>
        <button onClick={(e) => { e.stopPropagation(); moveBlock(index, 'down'); }} className="p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-95" disabled={index === layout.length - 1}><ChevronDown size={16} className="text-slate-600 dark:text-slate-400" /></button>
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
      case 'comparison':
        return (
          <div key={key} className="relative bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm h-full hover:shadow-md transition-all duration-300">
            {moveControls}
            <div className="flex items-center gap-2 mb-6">
              <div className="w-10 h-10 bg-sky-50 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400 rounded-xl flex items-center justify-center transition-colors"><TrendingUp size={20} /></div>
              <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-100">Frente al periodo anterior</h3>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">Comparado con {comparison.period}</p>
              </div>
            </div>
            <div className="space-y-3">
              {comparison.rows.map(row => {
                const isFlat = Math.abs(row.delta) < 0.005;
                const isGood = row.lowerIsBetter ? row.delta < 0 : row.delta > 0;
                const tone = isFlat
                  ? 'text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/50'
                  : isGood
                    ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                    : 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20';
                return (
                  <div key={row.label} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 transition-colors">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{row.label}</p>
                      <p className="text-xl font-black text-slate-900 dark:text-white">{Math.round(row.current).toLocaleString()}€</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Antes: {Math.round(row.previous).toLocaleString()}€</p>
                    </div>
                    <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black ${tone}`}>
                      {isFlat ? <Minus size={14} /> : row.delta > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                      {row.percent === null
                        ? (isFlat ? 'Igual' : 'Nuevo')
                        : `${row.percent > 0 ? '+' : ''}${row.percent.toFixed(0)}%`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      case 'categories': {
        const hasSlices = categoryBreakdown.slices.length > 0;
        return (
          <div key={key} className="relative bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm h-full hover:shadow-md transition-all duration-300">
            {moveControls}
            <div className="flex items-center gap-2 mb-6">
              <div className="w-10 h-10 bg-rose-50 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 rounded-xl flex items-center justify-center transition-colors"><PieChartIcon size={20} /></div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100">En qué se va</h3>
            </div>
            {hasSlices ? (
              <>
                <div className="relative h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={categoryBreakdown.slices} dataKey="value" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={2} stroke="none">
                        {categoryBreakdown.slices.map(slice => <Cell key={slice.name} fill={slice.color} />)}
                      </Pie>
                      <Tooltip
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', backgroundColor: theme === 'dark' ? '#0f172a' : '#fff', color: theme === 'dark' ? '#f1f5f9' : '#000' }}
                        formatter={(value: any, name: any) => [`${Number(value).toLocaleString()}€`, name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Gasto</p>
                    <p className="text-2xl font-black text-slate-900 dark:text-white">{Math.round(categoryBreakdown.total).toLocaleString()}€</p>
                  </div>
                </div>
                <div className="space-y-2 mt-4">
                  {categoryBreakdown.slices.map(slice => {
                    const share = categoryBreakdown.total > 0 ? (slice.value / categoryBreakdown.total) * 100 : 0;
                    return (
                      <button
                        key={slice.name}
                        onClick={() => navigate('/transactions', { state: { filterCategory: slice.name } })}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left"
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: slice.color }} />
                        <span className="flex-1 text-sm font-bold text-slate-700 dark:text-slate-300 truncate">{slice.name}</span>
                        <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 tabular-nums">{share.toFixed(0)}%</span>
                        <span className="text-sm font-black text-slate-900 dark:text-white tabular-nums">{Math.round(slice.value).toLocaleString()}€</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="text-center py-16">
                <AlertCircle size={32} className="mx-auto text-slate-300 dark:text-slate-700 mb-3" />
                <p className="text-xs font-bold text-slate-400 dark:text-slate-600 uppercase tracking-widest">Sin gastos en este periodo</p>
              </div>
            )}
          </div>
        );
      }
      case 'trends': {
        const axisTick = { fontSize: 10, fill: theme === 'dark' ? '#64748b' : '#94a3b8' };
        const grid = theme === 'dark' ? '#1e293b' : '#f1f5f9';
        const tooltipStyle = { borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', backgroundColor: theme === 'dark' ? '#0f172a' : '#fff', color: theme === 'dark' ? '#f1f5f9' : '#000' };
        const pill = (active: boolean) => `px-3.5 py-1.5 text-[10px] font-bold rounded-lg transition-all ${active ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`;
        return (
          <div key={key} className="relative bg-white dark:bg-slate-900 p-8 md:p-10 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm transition-all duration-300">
            {moveControls}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
              <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><SlidersHorizontal size={20} className="text-indigo-500" /> Evolución mes a mes</h3>
              <div className="flex flex-wrap gap-2">
                <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                  <button onClick={() => setTrendMetric('flow')} className={pill(trendMetric === 'flow')}>Ingreso y gasto</button>
                  <button onClick={() => setTrendMetric('savings')} className={pill(trendMetric === 'savings')}>Ahorro</button>
                  <button onClick={() => setTrendMetric('category')} className={pill(trendMetric === 'category')}>Categorías</button>
                </div>
                <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                  {[6, 12, 24].map(months => (
                    <button key={months} onClick={() => setTrendRange(months as 6 | 12 | 24)} className={pill(trendRange === months)}>{months} M</button>
                  ))}
                </div>
                {trendMetric !== 'category' && (
                  <button
                    onClick={() => setCompareLastYear(!compareLastYear)}
                    className={`px-3.5 py-1.5 text-[10px] font-bold rounded-xl border transition-all ${compareLastYear ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-transparent'}`}
                  >
                    Comparar con el año anterior
                  </button>
                )}
              </div>
            </div>

            {trendMetric === 'category' && (
              <div className="flex flex-wrap gap-2 mb-6">
                {expenseCategoryNames.length === 0 && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 italic">Aún no hay categorías con gasto en este periodo.</p>
                )}
                {expenseCategoryNames.map(category => {
                  const active = trendCategories.indexOf(category) !== -1;
                  return (
                    <button
                      key={category}
                      onClick={() => toggleTrendCategory(category)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-all ${active ? 'border-transparent text-white shadow-sm' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300'}`}
                      style={active ? { backgroundColor: colorForCategory(category) } : undefined}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: active ? 'rgba(255,255,255,0.8)' : colorForCategory(category) }} />
                      {category}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={grid} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={axisTick} interval="preserveStartEnd" />
                  <YAxis axisLine={false} tickLine={false} tick={axisTick} width={52} tickFormatter={(v: any) => `${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: any, name: any) => [`${Number(value).toLocaleString()}€`, name]} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                  {trendMetric === 'flow' && <Line type="monotone" dataKey="ingresos" name="Ingresos" stroke="#10b981" strokeWidth={3} dot={false} />}
                  {trendMetric === 'flow' && <Line type="monotone" dataKey="gastos" name="Gastos" stroke="#f43f5e" strokeWidth={3} dot={false} />}
                  {trendMetric === 'flow' && compareLastYear && <Line type="monotone" dataKey="ingresosAnterior" name="Ingresos año anterior" stroke="#10b981" strokeWidth={2} strokeDasharray="4 4" dot={false} />}
                  {trendMetric === 'flow' && compareLastYear && <Line type="monotone" dataKey="gastosAnterior" name="Gastos año anterior" stroke="#f43f5e" strokeWidth={2} strokeDasharray="4 4" dot={false} />}
                  {trendMetric === 'savings' && <Line type="monotone" dataKey="ahorro" name="Ahorro del mes" stroke="#3b82f6" strokeWidth={3} dot={false} />}
                  {trendMetric === 'savings' && compareLastYear && <Line type="monotone" dataKey="ahorroAnterior" name="Ahorro año anterior" stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 4" dot={false} />}
                  {trendMetric === 'category' && trendCategories.map(category => (
                    <Line key={category} type="monotone" dataKey={category} name={category} stroke={colorForCategory(category)} strokeWidth={3} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {trendMetric === 'category' && trendCategories.length === 0 && expenseCategoryNames.length > 0 && (
              <p className="text-center text-xs text-slate-400 dark:text-slate-500 italic mt-4">Elige una categoría arriba para dibujar su línea.</p>
            )}
          </div>
        );
      }
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
      case 'budget': {
        // Separado por tipo: antes el corte a cuatro se aplicaba sobre ingresos y
        // gastos mezclados, y por eso "faltaban" categorias que si existian.
        // Un presupuesto sin tipo cuenta como gasto en vez de desaparecer.
        const tabBudgets = budgetsWithCalculatedSpent.filter(b => (b.type || 'expense') === budgetTab);
        const displayedBudgets = isBudgetsExpanded ? tabBudgets : tabBudgets.slice(0, 4);
        return (
          <div key={key} className="relative bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm h-full hover:shadow-md transition-all duration-300">
            {moveControls}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-purple-50 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 rounded-xl flex items-center justify-center transition-colors"><ShoppingBag size={20} /></div>
                <h3 onClick={() => navigate('/budget')} className="font-bold text-slate-800 dark:text-slate-100 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline underline-offset-4 decoration-2 transition-all">Presupuestos Mes</h3>
              </div>
              {tabBudgets.length > 4 && (<button onClick={() => setIsBudgetsExpanded(!isBudgetsExpanded)} className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all shadow-sm"><ChevronDown className={`transition-transform duration-300 ${isBudgetsExpanded ? 'rotate-180' : ''}`} size={18} /></button>)}
            </div>
            <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl mb-6">
              <button onClick={() => { setBudgetTab('expense'); setIsBudgetsExpanded(false); }} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${budgetTab === 'expense' ? 'bg-white dark:bg-slate-700 shadow-sm text-rose-600 dark:text-rose-400' : 'text-slate-400 dark:text-slate-500'}`}>Gastos</button>
              <button onClick={() => { setBudgetTab('income'); setIsBudgetsExpanded(false); }} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${budgetTab === 'income' ? 'bg-white dark:bg-slate-700 shadow-sm text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>Ingresos</button>
            </div>
            <div className="space-y-6">
              {displayedBudgets.map(b => {
                const progress = b.limit > 0 ? Math.min((b.spent / b.limit) * 100, 100) : 0;
                const isOverBudget = b.type === 'expense' && b.spent > b.limit;
                return (
                  <div key={b.id} onClick={() => setSelectedBudgetForDetails(b)} className="cursor-pointer group space-y-1.5">
                    <div className="flex justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider"><span>{b.category}</span><span style={{ color: isOverBudget ? '#f43f5e' : b.color }}>{b.spent.toLocaleString('es-ES')}€ / {b.limit.toLocaleString('es-ES')}€ ({Math.round(progress)}%)</span></div>
                    <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden"><div className={`h-full transition-all duration-700`} style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${b.color || '#3b82f6'}40 0%, ${b.color || '#3b82f6'} 100%)` }}></div></div>
                    {b.totalRefunded > 0 && (<p className="text-[9px] font-black flex items-center gap-1 mt-1 transition-all" style={{ color: b.color }}><ChevronRight size={10} className="shrink-0" /> Reembolsado: +{b.totalRefunded.toLocaleString()}€ (Ahorro en gasto neto)</p>)}
                  </div>
                );
              })}
              {tabBudgets.length === 0 && (
                <p className="text-xs text-slate-400 dark:text-slate-500 italic text-center py-4">
                  {budgets.length === 0
                    ? 'Sin límites definidos.'
                    : budgetTab === 'expense'
                      ? 'Sin presupuestos de gasto este mes.'
                      : 'Sin presupuestos de ingreso este mes.'}
                </p>
              )}
            </div>
          </div>
        );
      }
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-min">{layout.map((key, idx) => { const isFullWidth = key === 'balance' || key === 'chart' || key === 'trends'; return (<div key={key} className={`${isFullWidth ? 'lg:col-span-2' : 'lg:col-span-1'} transition-all duration-300`}>{renderBlock(key, idx)}</div>); })}</div>
      {selectedBudgetForDetails && (
        <div className="fixed inset-0 bg-slate-900/90 z-[60] flex items-center justify-center p-4" onClick={() => setSelectedBudgetForDetails(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-[3rem] w-full max-w-lg p-8 md:p-10 shadow-2xl animate-in fade-in zoom-in duration-300 border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-8 flex-shrink-0"><div className="flex items-center gap-5"><div className={`w-16 h-16 rounded-[1.5rem] flex items-center justify-center shadow-lg dark:shadow-none transition-colors`} style={{ backgroundColor: `${selectedBudgetForDetails.color}${theme === 'dark' ? '30' : '15'}`, color: selectedBudgetForDetails.color }}>{ICON_MAP[selectedBudgetForDetails.icon] ? (React.cloneElement(ICON_MAP[selectedBudgetForDetails.icon] as React.ReactElement, { size: 28 })) : (<span className="text-3xl">{selectedBudgetForDetails.icon || <ShoppingBag size={28} />}</span>)}</div><div><h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{selectedBudgetForDetails.category}</h3><p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Movimientos de {currentDate}</p></div></div><button onClick={() => setSelectedBudgetForDetails(null)} className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400"><X size={24} /></button></div>
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-3xl p-6 mb-8 border border-slate-100 dark:border-slate-800 flex-shrink-0 transition-colors"><div className="flex justify-between items-end mb-4"><div><p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1">Total acumulado</p><p className="text-3xl font-black text-slate-900 dark:text-white transition-colors">{selectedBudgetForDetails.spent.toLocaleString()}€</p></div><div className="text-right"><p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1">Límite</p><p className="text-lg font-bold text-slate-600 dark:text-slate-400 transition-colors">{selectedBudgetForDetails.limit.toLocaleString()}€</p></div></div><div className="w-full h-3 bg-white dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700"><div className={`h-full rounded-full transition-all duration-1000`} style={{ width: `${Math.min((selectedBudgetForDetails.spent / selectedBudgetForDetails.limit) * 100, 100)}%`, background: `linear-gradient(90deg, ${selectedBudgetForDetails.color}40 0%, ${selectedBudgetForDetails.color} 100%)` }}></div></div></div>
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
