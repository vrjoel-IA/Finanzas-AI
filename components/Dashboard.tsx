
import React, { useMemo, useState } from 'react';
import { useFinance } from '../App';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  PiggyBank,
  Wallet,
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
  SlidersHorizontal,
  List,
  RefreshCw,
  GitCompareArrows,
} from 'lucide-react';
import {
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
  Legend,
} from 'recharts';
import { generateMonthReport } from '../services/geminiService';
import { Transaction } from '../types';
import { ICON_MAP, CATEGORIES, INCOME_CATEGORIES, BUDGET_PRESET_COLORS } from '../constants';
import { aggregatePeriod, categorySpent, periodHeadline, savingFlow, topCategories } from '../services/periodIndex';
import { isMonthKey, isYearKey, monthRange, shiftMonth, sameMonthPreviousYear } from '../services/periods';
import { mergeLayout } from '../services/dashboardBlocks';
import { budgetStatus } from '../services/budgetPlan';
import type { BudgetType } from '../services/budgetPlan';
import { buildMonthReport, periodLabel } from '../services/monthReport';
import type { WatchItem } from '../services/monthReport';
import { budgetRowTone } from './budgetTone';

type EvolutionMode = 'networth' | 'flow' | 'category';
type FlowSeries = 'income' | 'expense' | 'saving';
type CompareMode = 'previous' | 'lastYear' | 'custom';

interface DashboardBudget {
  id: string;
  key: string;
  category: string;
  type: BudgetType;
  icon: string;
  color: string;
  limit: number;
  spent: number;
  totalRefunded: number;
}

const SAVING_COLOR = '#f59e0b';
const FLOW_COLORS: Record<FlowSeries, string> = { income: '#10b981', expense: '#f43f5e', saving: SAVING_COLOR };
const FLOW_LABELS: Record<FlowSeries, string> = { income: 'Ingresos', expense: 'Gastos', saving: 'Ahorro' };
const FLOW_KEYS: Record<FlowSeries, string> = { income: 'ingresos', expense: 'gastos', saving: 'ahorro' };
const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const monthLabel = (key: string) => MONTH_SHORT[Number(key.slice(5, 7)) - 1] + " " + key.slice(2, 4);
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const euros = (value: number) => `${Math.round(value).toLocaleString('es-ES')}€`;

/** Fecha local de hoy en 'YYYY-MM-DD', sin pasar por UTC. */
const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const Dashboard: React.FC = () => {
  const {
    accounts,
    savings,
    transactions,
    currentDate,
    getEffectiveBudgets,
    dashboardLayout,
    updateLayout,
    getAccountHistoricalBalance,
    getSavingHistoricalBalance,
    getNetWorthHistorical,
    viewIndex,
    viewMode,
    theme,
    auraReports,
    saveAuraReport,
  } = useFinance();

  const navigate = useNavigate();
  const [isEditMode, setIsEditMode] = useState(false);
  // Abierto por defecto: las tarjetas de Ingresos, Gastos y Ahorro son la
  // entrada a cada pestaña de Presupuestos y no deben quedar escondidas.
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [selectedBudgetForDetails, setSelectedBudgetForDetails] = useState<DashboardBudget | null>(null);
  const [isBudgetsExpanded, setIsBudgetsExpanded] = useState(false);
  const [budgetTab, setBudgetTab] = useState<BudgetType>('expense');
  const [budgetView, setBudgetView] = useState<'list' | 'chart'>('list');
  const [evolutionMode, setEvolutionMode] = useState<EvolutionMode>('networth');
  const [flowSeries, setFlowSeries] = useState<FlowSeries[]>(['income', 'expense', 'saving']);
  const [trendRange, setTrendRange] = useState<6 | 12 | 24>(12);
  const [trendCategories, setTrendCategories] = useState<string[]>([]);
  const [compareLastYear, setCompareLastYear] = useState(false);
  const [compareMode, setCompareMode] = useState<CompareMode>('previous');
  const [compareCustom, setCompareCustom] = useState('');
  const [isGeneratingComment, setIsGeneratingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const budgets = useMemo(() => getEffectiveBudgets(currentDate), [getEffectiveBudgets, currentDate]);
  const agg = useMemo(() => aggregatePeriod(viewIndex, currentDate), [viewIndex, currentDate]);

  const goToBudget = (tab: BudgetType) => navigate('/budget', { state: { tab } });

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

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    const newLayout = [...layout];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newLayout.length) return;
    [newLayout[index], newLayout[targetIndex]] = [newLayout[targetIndex], newLayout[index]];
    updateLayout(newLayout);
  };

  // Presupuestos del periodo con lo gastado, ingresado o aportado, desde el indice
  // compartido. Los objetivos de ahorro toman nombre y color de su hucha.
  const budgetsWithCalculatedSpent = useMemo<DashboardBudget[]>(() => {
    const rows: DashboardBudget[] = [];
    budgets.forEach(b => {
      const type = (b.type || 'expense') as BudgetType;
      if (type === 'saving') {
        const saving = savings.filter(s => s.id === b.savingId)[0];
        if (!saving) return;
        rows.push({
          id: b.id, key: 'saving|' + saving.id, category: saving.name, type, icon: saving.emoji || '💰',
          color: saving.color || SAVING_COLOR, limit: b.limit,
          spent: savingFlow(viewIndex, saving.id, currentDate).deposits, totalRefunded: 0,
        });
        return;
      }
      const flow = agg.byCategory[b.category];
      rows.push({
        id: b.id, key: b.category + '|' + type, category: b.category, type, icon: b.icon,
        color: b.color || '#3b82f6', limit: b.limit,
        spent: categorySpent(agg, b.category, type),
        totalRefunded: flow ? flow.refunded : 0,
      });
    });
    return rows;
  }, [budgets, savings, viewIndex, currentDate, agg]);

  // El layout guardado de un usuario antiguo no conoce los bloques nuevos. Se
  // fusiona en LECTURA: escribirlo al arrancar subiria el estado entero a la nube.
  const layout = useMemo(() => mergeLayout(dashboardLayout), [dashboardLayout]);

  // Color estable por categoria: el del presupuesto si existe, si no el del
  // catalogo, y como ultimo recurso uno de la paleta segun el nombre.
  const colorForCategory = useMemo(() => {
    const table: Record<string, string> = {};
    [...CATEGORIES, ...INCOME_CATEGORIES].forEach(c => { table[c.name] = c.color; });
    budgets.forEach(b => { if (b.color && b.type !== 'saving') table[b.category] = b.color; });
    return (name: string) => {
      if (table[name]) return table[name];
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 997;
      return BUDGET_PRESET_COLORS[hash % BUDGET_PRESET_COLORS.length];
    };
  }, [budgets]);

  // ---------------------------------------------------------------------------
  // Informe de Aura
  // ---------------------------------------------------------------------------
  const today = todayKey();
  const report = useMemo(
    () => buildMonthReport({ period: currentDate, today, budgets, index: viewIndex, savings }),
    [currentDate, today, budgets, viewIndex, savings],
  );
  const savedComment = auraReports ? auraReports[currentDate] : undefined;
  const commentIsStale = !!savedComment && (savedComment.kind !== report.kind || savedComment.txCount !== report.txCount);

  const handleAuraComment = async () => {
    // El periodo se fija al pulsar: si el usuario cambia de mes mientras Aura
    // responde, el comentario se guarda en el mes que pidio, no en el que mira.
    const period = currentDate;
    const snapshot = report;
    setIsGeneratingComment(true);
    setCommentError(null);
    try {
      const comment = await generateMonthReport({
        periodo: snapshot.label, kind: snapshot.kind, ritmo: snapshot.pace, cifras: snapshot.headline,
        periodoAnterior: snapshot.previous, media3Meses: snapshot.typical, presupuestoGasto: snapshot.expenseBudget,
        vigilar: snapshot.watch, excedidos: snapshot.overCount, ingresos: snapshot.incomeGoal,
        objetivosAhorro: snapshot.savingGoals, sinPresupuesto: snapshot.unbudgeted, resumen: snapshot.lines,
      });
      saveAuraReport(period, {
        kind: snapshot.kind,
        txCount: snapshot.txCount,
        generatedAt: new Date().toISOString(),
        titular: comment.titular,
        puntos: comment.puntos,
        consejo: comment.consejo,
      });
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : 'No se ha podido hablar con Aura.');
    } finally {
      setIsGeneratingComment(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Comparativa con un periodo elegido
  // ---------------------------------------------------------------------------
  const comparePeriod = useMemo(() => {
    if (isMonthKey(currentDate)) {
      if (compareMode === 'lastYear') return shiftMonth(currentDate, -12);
      if (compareMode === 'custom' && isMonthKey(compareCustom)) return compareCustom;
      return shiftMonth(currentDate, -1);
    }
    if (compareMode === 'custom' && isYearKey(compareCustom)) return compareCustom;
    return String(Number(currentDate) - 1);
  }, [currentDate, compareMode, compareCustom]);

  const availableYears = useMemo(() => {
    const years: string[] = [];
    viewIndex.monthKeys.forEach(key => {
      const year = key.slice(0, 4);
      if (year !== currentDate.slice(0, 4) && years.indexOf(year) === -1) years.push(year);
    });
    return years.sort().reverse();
  }, [viewIndex, currentDate]);

  const comparison = useMemo(() => {
    const now = periodHeadline(agg);
    const before = periodHeadline(aggregatePeriod(viewIndex, comparePeriod));
    const row = (label: string, current: number, previous: number, lowerIsBetter: boolean, tab: BudgetType | null) => {
      const delta = current - previous;
      const hasBase = Math.abs(previous) > 0.005;
      return { label, current, previous, delta, percent: hasBase ? (delta / Math.abs(previous)) * 100 : null, lowerIsBetter, tab };
    };
    return [
      row('Ingresos', now.income, before.income, false, 'income'),
      row('Gastos', now.expense, before.expense, true, 'expense'),
      row('Ahorro', now.saving, before.saving, false, 'saving'),
      row('Resultado', now.result, before.result, false, null),
    ];
  }, [agg, viewIndex, comparePeriod]);

  // ---------------------------------------------------------------------------
  // Evolucion: patrimonio, flujo y categorias en un solo bloque
  // ---------------------------------------------------------------------------
  const expenseCategoryNames = useMemo(() => topCategories(agg, 'expense', 8).map(row => row.category), [agg]);

  // El eje es SIEMPRE mensual, tambien en vista anual: con claves de anio el
  // patrimonio salia como una linea plana.
  const trendData = useMemo(() => {
    const end = isMonthKey(currentDate) ? currentDate : currentDate.slice(0, 4) + '-12';
    return monthRange(end, trendRange).map(key => {
      const point: Record<string, any> = { key, name: monthLabel(key) };
      if (evolutionMode === 'networth') {
        point.patrimonio = Math.round(getNetWorthHistorical(key));
        if (compareLastYear) point.patrimonioAnterior = Math.round(getNetWorthHistorical(shiftMonth(key, -12)));
        return point;
      }
      const headline = periodHeadline(aggregatePeriod(viewIndex, key));
      point.ingresos = Math.round(headline.income);
      point.gastos = Math.round(headline.expense);
      point.ahorro = Math.round(headline.saving);
      if (compareLastYear) {
        const lastYearKey = sameMonthPreviousYear(key);
        const prev = lastYearKey ? periodHeadline(aggregatePeriod(viewIndex, lastYearKey)) : null;
        point.ingresosAnterior = prev ? Math.round(prev.income) : 0;
        point.gastosAnterior = prev ? Math.round(prev.expense) : 0;
        point.ahorroAnterior = prev ? Math.round(prev.saving) : 0;
      }
      if (evolutionMode === 'category') {
        const monthAgg = aggregatePeriod(viewIndex, key);
        trendCategories.forEach(category => {
          point[category] = Math.round(categorySpent(monthAgg, category, 'expense'));
        });
      }
      return point;
    });
  }, [viewIndex, currentDate, trendRange, trendCategories, compareLastYear, evolutionMode, getNetWorthHistorical]);

  const toggleTrendCategory = (category: string) => {
    setTrendCategories(prev =>
      prev.indexOf(category) === -1 ? [...prev, category] : prev.filter(c => c !== category),
    );
  };

  const toggleFlowSeries = (series: FlowSeries) => {
    setFlowSeries(prev => {
      if (prev.indexOf(series) === -1) return [...prev, series];
      // Siempre queda al menos una linea: un grafico vacio no ayuda a nadie.
      return prev.length > 1 ? prev.filter(s => s !== series) : prev;
    });
  };

  // ---------------------------------------------------------------------------
  // Anillo del bloque de presupuestos, segun la pestaña
  // ---------------------------------------------------------------------------
  const donut = useMemo(() => {
    let rows: { name: string; value: number; color: string }[];
    if (budgetTab === 'saving') {
      rows = savings
        .map(s => ({ name: s.name, value: savingFlow(viewIndex, s.id, currentDate).deposits, color: s.color || SAVING_COLOR }))
        .filter(r => r.value > 0);
      const assigned = rows.reduce((sum, r) => sum + r.value, 0);
      const unassigned = agg.savingDeposits - assigned;
      if (unassigned > 0.005) rows.push({ name: 'Sin hucha', value: unassigned, color: '#94a3b8' });
      rows.sort((a, b) => b.value - a.value);
    } else {
      rows = topCategories(agg, budgetTab, 0).map(r => ({ name: r.category, value: r.amount, color: colorForCategory(r.category) }));
    }
    const total = rows.reduce((sum, r) => sum + r.value, 0);
    const slices = rows.slice(0, 5);
    const rest = rows.slice(5).reduce((sum, r) => sum + r.value, 0);
    if (rest > 0) slices.push({ name: 'Otros', value: rest, color: '#cbd5e1' });
    return { slices, total };
  }, [budgetTab, savings, viewIndex, currentDate, agg, colorForCategory]);

  const tooltipStyle = { borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', backgroundColor: theme === 'dark' ? '#0f172a' : '#fff', color: theme === 'dark' ? '#f1f5f9' : '#000' };
  const pill = (active: boolean) => `px-3.5 py-1.5 text-[10px] font-bold rounded-lg transition-all ${active ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`;
  const cardClass = 'relative bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm h-full hover:shadow-md transition-all duration-300';

  const watchText = (w: WatchItem) => {
    if (w.status === 'over') return `${w.category}: te has pasado ${euros(w.spent - w.limit)}`;
    if (w.status === 'at-risk') return `${w.category}: ${Math.round((w.spent / (w.limit || 1)) * 100)}% usado`;
    return `${w.category}: a este ritmo, ${euros(w.projected || 0)} de ${euros(w.limit)}`;
  };

  const renderBlock = (key: string, index: number) => {
    const moveControls = isEditMode && (
      <div className="absolute top-4 right-4 flex gap-1 z-20">
        <button onClick={(e) => { e.stopPropagation(); moveBlock(index, 'up'); }} className="p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-95" disabled={index === 0}><ChevronUp size={16} className="text-slate-600 dark:text-slate-400" /></button>
        <button onClick={(e) => { e.stopPropagation(); moveBlock(index, 'down'); }} className="p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-95" disabled={index === layout.length - 1}><ChevronDown size={16} className="text-slate-600 dark:text-slate-400" /></button>
      </div>
    );

    switch (key) {
      case 'balance': {
        const tile = 'p-5 backdrop-blur-md rounded-[1.8rem] border border-white/10 flex flex-col justify-between text-left transition-all hover:border-white/40 hover:scale-[1.02] active:scale-[0.98]';
        return (
          <div key={key} className="relative h-full bg-[#2563eb] dark:bg-blue-600 rounded-[2.5rem] p-8 md:p-10 text-white shadow-2xl shadow-blue-200/50 dark:shadow-blue-900/20 overflow-hidden transition-colors duration-300">
            {moveControls}
            {/* h-full + justify-between: ocupa el alto de la fila en vez de dejar un hueco bajo la tarjeta. */}
            <div className="relative z-10 flex flex-col h-full justify-between">
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-10">
                <div><p className="text-blue-100 text-[9px] font-black uppercase tracking-[0.2em] mb-2 opacity-80">Patrimonio Neto en {currentDate}</p><h2 className="text-4xl md:text-5xl font-black tracking-tight">{metrics.netWorth.toLocaleString()}€</h2></div>
                <button onClick={() => setShowBreakdown(!showBreakdown)} className="px-5 py-3 rounded-2xl flex items-center gap-2 text-xs font-black transition-all shadow-lg bg-white/20 backdrop-blur-md hover:bg-white/30 active:scale-95">{metrics.monthResult >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}{metrics.monthResult >= 0 ? '+' : ''}{metrics.monthResult.toLocaleString()}€ este mes<ChevronDown size={14} className={`transition-transform duration-300 ${showBreakdown ? 'rotate-180' : ''}`} /></button>
              </div>
              {showBreakdown && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 animate-in slide-in-from-top-4 duration-300">
                  <button onClick={() => goToBudget('income')} className={`${tile} bg-emerald-500/30`}>
                    <p className="text-[9px] font-black uppercase tracking-wider text-emerald-100 flex items-center justify-between w-full">Ingresos <ChevronRight size={12} /></p>
                    <p className="text-2xl font-black">{metrics.totalInflow.toLocaleString()}€</p>
                    <p className="text-[8px] opacity-70 mt-1 font-bold">Base: {metrics.baseIncome}€ | Retiradas Hucha: {metrics.savingWithdrawals}€</p>
                  </button>
                  <button onClick={() => goToBudget('expense')} className={`${tile} bg-rose-500/30`}>
                    <p className="text-[9px] font-black uppercase tracking-wider text-rose-100 flex items-center justify-between w-full">Gasto Neto <ChevronRight size={12} /></p>
                    <p className="text-2xl font-black">{metrics.expense.toLocaleString()}€</p>
                    {metrics.refundRecoveries > 0 && (<p className="text-[9px] font-bold text-rose-200 opacity-80 mt-1">(-{metrics.refundRecoveries.toLocaleString()}€ reembolsos)</p>)}
                  </button>
                  <button onClick={() => goToBudget('saving')} className={`${tile} bg-amber-500/30`}>
                    <p className="text-[9px] font-black uppercase tracking-wider text-amber-100 flex items-center justify-between w-full">Ahorro <ChevronRight size={12} /></p>
                    <p className="text-2xl font-black">{metrics.savingDeposits.toLocaleString()}€</p>
                    <p className="text-[8px] opacity-70 mt-1 font-bold">Dinero movido a huchas (resta de liquidez)</p>
                  </button>
                </div>
              )}
              <div>
              <div className="h-px bg-white/15 w-full mb-8"></div>
              <div className="grid grid-cols-3 gap-4 md:gap-8">
                <button onClick={() => navigate('/accounts')} className="text-left hover:opacity-80 transition-opacity"><p className="text-[9px] text-blue-200 font-black uppercase tracking-[0.15em] mb-3 opacity-90">Saldo Anterior</p><p className="text-lg md:text-2xl font-black">{metrics.pastLiquidBalance.toLocaleString()}€</p></button>
                <button onClick={() => setShowBreakdown(!showBreakdown)} className="text-left hover:opacity-80 transition-opacity"><p className="text-[9px] text-blue-200 font-black uppercase tracking-[0.15em] mb-3 opacity-90">Resultado Mes</p><p className="text-lg md:text-2xl font-black">{metrics.monthResult.toLocaleString()}€</p></button>
                <button onClick={() => navigate('/accounts')} className="text-left hover:opacity-80 transition-opacity"><p className="text-[9px] text-blue-200 font-black uppercase tracking-[0.15em] mb-3 opacity-90">Liquidez Actual</p><p className="text-lg md:text-2xl font-black">{metrics.liquidity.toLocaleString()}€</p></button>
              </div>
              </div>
            </div>
          </div>
        );
      }
      case 'report': {
        const title = report.kind === 'progress'
          ? `Cómo va ${report.label}`
          : report.kind === 'summary'
            ? `Resumen de ${report.label}`
            : capitalize(report.label);
        return (
          <div key={key} className={cardClass}>
            {moveControls}
            <div className="flex items-center justify-between gap-3 mb-5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-xl flex items-center justify-center shrink-0 transition-colors"><Sparkles size={20} /></div>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 truncate">{title}</h3>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">Informe de Aura</p>
                </div>
              </div>
            </div>

            <ul className="space-y-2.5 mb-5">
              {report.lines.map((line, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-600 dark:text-slate-300 leading-snug">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            {report.watch.length > 0 && (
              <div className="mb-5">
                <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">{report.kind === 'summary' ? 'Dónde se fue de las manos' : 'Vigila'}</p>
                <div className="flex flex-wrap gap-2">
                  {report.watch.map(w => (
                    <button
                      key={w.category}
                      onClick={() => goToBudget('expense')}
                      className={`px-3 py-1.5 rounded-xl text-[11px] font-bold text-left transition-all hover:scale-[1.02] ${w.status === 'over' ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300' : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'}`}
                    >
                      {watchText(w)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {savedComment && (
              <div className="p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50 mb-4">
                <p className="text-sm font-black text-blue-900 dark:text-blue-200 mb-2">{savedComment.titular}</p>
                <ul className="space-y-1.5 mb-2">
                  {savedComment.puntos.map((p, i) => (
                    <li key={i} className="text-xs text-blue-800/90 dark:text-blue-200/80 leading-snug">· {p}</li>
                  ))}
                </ul>
                {savedComment.consejo && <p className="text-xs font-bold text-blue-700 dark:text-blue-300">👉 {savedComment.consejo}</p>}
                {commentIsStale && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 italic">Hay movimientos nuevos desde este comentario.</p>}
              </div>
            )}

            {commentError && <p className="text-xs font-bold text-rose-600 dark:text-rose-400 mb-3">{commentError}</p>}

            <button
              onClick={handleAuraComment}
              disabled={isGeneratingComment}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-black bg-blue-600 text-white hover:bg-blue-700 transition-all disabled:opacity-50 active:scale-[0.98]"
            >
              {isGeneratingComment
                ? <Loader2 className="animate-spin" size={16} />
                : savedComment ? <RefreshCw size={16} /> : <Sparkles size={16} />}
              {savedComment ? (commentIsStale ? 'Actualizar comentario de Aura' : 'Pedir otro comentario') : 'Comentario de Aura'}
            </button>
          </div>
        );
      }
      case 'savings':
        return (
          <div key={key} className={cardClass}>
            {moveControls}
            <div className="flex items-center gap-2 mb-6">
              <div className="w-10 h-10 bg-amber-50 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 rounded-xl flex items-center justify-center transition-colors"><PiggyBank size={20} /></div>
              <h3 onClick={() => navigate('/savings')} className="font-bold text-slate-800 dark:text-slate-100 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline underline-offset-4 decoration-2 transition-all">Ahorro en {currentDate}</h3>
            </div>
            <div className="text-center py-6"><p className="text-4xl font-black text-slate-900 dark:text-white">{metrics.totalSavingsAccumulated.toLocaleString()}€</p><p className="text-xs text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-2">Capital acumulado histórico</p></div>
            <div className="grid grid-cols-2 gap-2 mt-4">{savings.slice(0, 4).map(s => (<div key={s.id} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 transition-colors"><p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold truncate uppercase tracking-tighter">{s.name}</p><p className="text-xs font-black text-slate-700 dark:text-slate-200">{getSavingHistoricalBalance(s.id, currentDate).toLocaleString()}€</p></div>))}</div>
          </div>
        );
      case 'comparison': {
        const isMonth = isMonthKey(currentDate);
        const compareLabel = isMonth ? capitalize(periodLabel(comparePeriod)) : comparePeriod;
        return (
          <div key={key} className={cardClass}>
            {moveControls}
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 bg-sky-50 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400 rounded-xl flex items-center justify-center transition-colors shrink-0"><GitCompareArrows size={20} /></div>
              <div className="min-w-0">
                <h3 className="font-bold text-slate-800 dark:text-slate-100">Comparativa</h3>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest truncate">{isMonth ? capitalize(periodLabel(currentDate)) : currentDate} vs {compareLabel}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-5">
              <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                <button onClick={() => setCompareMode('previous')} className={pill(compareMode === 'previous')}>{isMonth ? 'Mes anterior' : 'Año anterior'}</button>
                {isMonth && <button onClick={() => setCompareMode('lastYear')} className={pill(compareMode === 'lastYear')}>Hace un año</button>}
                <button onClick={() => setCompareMode('custom')} className={pill(compareMode === 'custom')}>Elegir</button>
              </div>
              {compareMode === 'custom' && (isMonth ? (
                <input
                  type="month"
                  value={isMonthKey(compareCustom) ? compareCustom : shiftMonth(currentDate, -1)}
                  max={currentDate}
                  onChange={e => setCompareCustom(e.target.value)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-0 outline-none"
                />
              ) : (
                <select
                  value={isYearKey(compareCustom) ? compareCustom : comparePeriod}
                  onChange={e => setCompareCustom(e.target.value)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-0 outline-none"
                >
                  {(availableYears.length ? availableYears : [comparePeriod]).map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              ))}
            </div>
            <div className="space-y-2.5">
              {comparison.map(row => {
                const isFlat = Math.abs(row.delta) < 0.005;
                const isGood = row.lowerIsBetter ? row.delta < 0 : row.delta > 0;
                const tone = isFlat
                  ? 'text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/50'
                  : isGood
                    ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                    : 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20';
                const tab = row.tab;
                return (
                  <button
                    key={row.label}
                    onClick={() => { if (tab) goToBudget(tab); }}
                    className={`w-full flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 transition-colors text-left ${tab ? 'hover:border-slate-300 dark:hover:border-slate-600' : 'cursor-default'}`}
                  >
                    <div>
                      <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{row.label}</p>
                      <p className="text-lg font-black text-slate-900 dark:text-white">{euros(row.current)}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Entonces: {euros(row.previous)}</p>
                    </div>
                    <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black ${tone}`}>
                      {isFlat ? <Minus size={14} /> : row.delta > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                      {row.percent === null
                        ? (isFlat ? 'Igual' : 'Nuevo')
                        : `${row.percent > 0 ? '+' : ''}${row.percent.toFixed(0)}%`}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      }
      case 'evolution': {
        const axisTick = { fontSize: 10, fill: theme === 'dark' ? '#64748b' : '#94a3b8' };
        const grid = theme === 'dark' ? '#1e293b' : '#f1f5f9';
        return (
          <div key={key} className="relative bg-white dark:bg-slate-900 p-8 md:p-10 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm transition-all duration-300">
            {moveControls}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
              <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><SlidersHorizontal size={20} className="text-indigo-500" /> Evolución</h3>
              <div className="flex flex-wrap gap-2">
                <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                  <button onClick={() => setEvolutionMode('networth')} className={pill(evolutionMode === 'networth')}>Patrimonio</button>
                  <button onClick={() => setEvolutionMode('flow')} className={pill(evolutionMode === 'flow')}>Ingresos · Gastos · Ahorro</button>
                  <button onClick={() => setEvolutionMode('category')} className={pill(evolutionMode === 'category')}>Categorías</button>
                </div>
                <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                  {[6, 12, 24].map(months => (
                    <button key={months} onClick={() => setTrendRange(months as 6 | 12 | 24)} className={pill(trendRange === months)}>{months} M</button>
                  ))}
                </div>
                {evolutionMode !== 'category' && (
                  <button
                    onClick={() => setCompareLastYear(!compareLastYear)}
                    className={`px-3.5 py-1.5 text-[10px] font-bold rounded-xl border transition-all ${compareLastYear ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-transparent'}`}
                  >
                    Comparar con el año anterior
                  </button>
                )}
              </div>
            </div>

            {evolutionMode === 'flow' && (
              <div className="flex flex-wrap gap-2 mb-6">
                {(['income', 'expense', 'saving'] as FlowSeries[]).map(series => {
                  const active = flowSeries.indexOf(series) !== -1;
                  return (
                    <button
                      key={series}
                      onClick={() => toggleFlowSeries(series)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-all ${active ? 'border-transparent text-white shadow-sm' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300'}`}
                      style={active ? { backgroundColor: FLOW_COLORS[series] } : undefined}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: active ? 'rgba(255,255,255,0.8)' : FLOW_COLORS[series] }} />
                      {FLOW_LABELS[series]}
                    </button>
                  );
                })}
              </div>
            )}

            {evolutionMode === 'category' && (
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
                  <YAxis axisLine={false} tickLine={false} tick={axisTick} width={52} tickFormatter={(v: any) => {
                    // Con un decimal por debajo de 10k: redondeado a miles salian "1k, 1k, 2k, 2k".
                    const n = Number(v);
                    if (Math.abs(n) < 1000) return `${Math.round(n)}`;
                    const k = n / 1000;
                    return `${Math.abs(n) < 10000 && k % 1 !== 0 ? k.toFixed(1).replace('.', ',') : Math.round(k)}k`;
                  }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: any, name: any) => [`${Number(value).toLocaleString()}€`, name]} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                  {evolutionMode === 'networth' && <Line type="monotone" dataKey="patrimonio" name="Patrimonio" stroke="#3b82f6" strokeWidth={3} dot={false} />}
                  {evolutionMode === 'networth' && compareLastYear && <Line type="monotone" dataKey="patrimonioAnterior" name="Patrimonio año anterior" stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 4" dot={false} />}
                  {evolutionMode === 'flow' && flowSeries.map(series => (
                    <Line key={series} type="monotone" dataKey={FLOW_KEYS[series]} name={FLOW_LABELS[series]} stroke={FLOW_COLORS[series]} strokeWidth={3} dot={false} />
                  ))}
                  {evolutionMode === 'flow' && compareLastYear && flowSeries.map(series => (
                    <Line key={series + '-prev'} type="monotone" dataKey={FLOW_KEYS[series] + 'Anterior'} name={`${FLOW_LABELS[series]} año anterior`} stroke={FLOW_COLORS[series]} strokeWidth={2} strokeDasharray="4 4" dot={false} />
                  ))}
                  {evolutionMode === 'category' && trendCategories.map(category => (
                    <Line key={category} type="monotone" dataKey={category} name={category} stroke={colorForCategory(category)} strokeWidth={3} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {evolutionMode === 'category' && trendCategories.length === 0 && expenseCategoryNames.length > 0 && (
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
        const tabBudgets = budgetsWithCalculatedSpent.filter(b => b.type === budgetTab);
        const displayedBudgets = isBudgetsExpanded ? tabBudgets : tabBudgets.slice(0, 4);
        const tabButton = (tab: BudgetType, label: string, tone: string) => (
          <button onClick={() => { setBudgetTab(tab); setIsBudgetsExpanded(false); }} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${budgetTab === tab ? `bg-white dark:bg-slate-700 shadow-sm ${tone}` : 'text-slate-400 dark:text-slate-500'}`}>{label}</button>
        );
        const centerLabel = budgetTab === 'expense' ? 'Gasto' : budgetTab === 'income' ? 'Ingreso' : 'Ahorro';
        return (
          <div key={key} className={cardClass}>
            {moveControls}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-purple-50 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 rounded-xl flex items-center justify-center transition-colors"><ShoppingBag size={20} /></div>
                <h3 onClick={() => goToBudget(budgetTab)} className="font-bold text-slate-800 dark:text-slate-100 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline underline-offset-4 decoration-2 transition-all">Presupuestos</h3>
              </div>
              <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                <button onClick={() => setBudgetView('list')} title="Lista" className={`p-1.5 rounded-lg transition-all ${budgetView === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}><List size={16} /></button>
                <button onClick={() => setBudgetView('chart')} title="Gráfico" className={`p-1.5 rounded-lg transition-all ${budgetView === 'chart' ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}><PieChartIcon size={16} /></button>
              </div>
            </div>
            <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl mb-6">
              {tabButton('expense', 'Gastos', 'text-rose-600 dark:text-rose-400')}
              {tabButton('income', 'Ingresos', 'text-emerald-600 dark:text-emerald-400')}
              {tabButton('saving', 'Ahorros', 'text-amber-600 dark:text-amber-400')}
            </div>

            {budgetView === 'list' ? (
              <div className="space-y-3">
                {displayedBudgets.map(b => {
                  const progress = b.limit > 0 ? Math.min((b.spent / b.limit) * 100, 100) : 0;
                  const status = budgetStatus({ type: b.type, spent: b.spent, limit: b.limit });
                  return (
                    <div
                      key={b.key}
                      onClick={() => (b.type === 'saving' ? goToBudget('saving') : setSelectedBudgetForDetails(b))}
                      className={`cursor-pointer group space-y-1.5 p-2.5 -mx-2.5 rounded-xl transition-colors ${budgetRowTone(b.type, status)}`}
                    >
                      <div className="flex justify-between gap-2 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider"><span className="truncate">{b.category}</span><span className="shrink-0" style={{ color: b.color }}>{b.spent.toLocaleString('es-ES')}€ / {b.limit.toLocaleString('es-ES')}€ ({Math.round(progress)}%)</span></div>
                      <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden"><div className="h-full transition-all duration-700" style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${b.color}40 0%, ${b.color} 100%)` }}></div></div>
                      {b.totalRefunded > 0 && (<p className="text-[9px] font-black flex items-center gap-1 mt-1 transition-all" style={{ color: b.color }}><ChevronRight size={10} className="shrink-0" /> Reembolsado: +{b.totalRefunded.toLocaleString()}€ (Ahorro en gasto neto)</p>)}
                    </div>
                  );
                })}
                {tabBudgets.length > 4 && (
                  <button onClick={() => setIsBudgetsExpanded(!isBudgetsExpanded)} className="w-full flex items-center justify-center gap-1 pt-2 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                    {isBudgetsExpanded ? 'Ver menos' : `Ver ${tabBudgets.length - 4} más`}
                    <ChevronDown className={`transition-transform duration-300 ${isBudgetsExpanded ? 'rotate-180' : ''}`} size={14} />
                  </button>
                )}
                {tabBudgets.length === 0 && (
                  <button onClick={() => goToBudget(budgetTab)} className="w-full text-xs text-slate-400 dark:text-slate-500 italic text-center py-4 hover:text-blue-600">
                    {budgetTab === 'expense'
                      ? 'Sin presupuestos de gasto este mes.'
                      : budgetTab === 'income'
                        ? 'Sin presupuestos de ingreso este mes.'
                        : 'Sin objetivos de ahorro este mes.'}
                  </button>
                )}
              </div>
            ) : donut.slices.length > 0 ? (
              <>
                <div className="relative h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donut.slices} dataKey="value" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={2} stroke="none">
                        {donut.slices.map(slice => <Cell key={slice.name} fill={slice.color} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(value: any, name: any) => [`${Number(value).toLocaleString()}€`, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{centerLabel}</p>
                    <p className="text-2xl font-black text-slate-900 dark:text-white">{euros(donut.total)}</p>
                  </div>
                </div>
                <div className="space-y-1 mt-4">
                  {donut.slices.map(slice => {
                    const share = donut.total > 0 ? (slice.value / donut.total) * 100 : 0;
                    const clickable = slice.name !== 'Otros' && slice.name !== 'Sin hucha';
                    return (
                      <button
                        key={slice.name}
                        onClick={() => {
                          if (!clickable) return;
                          if (budgetTab === 'saving') goToBudget('saving');
                          else navigate('/transactions', { state: { filterCategory: slice.name } });
                        }}
                        className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-colors text-left ${clickable ? 'hover:bg-slate-50 dark:hover:bg-slate-800/50' : 'cursor-default'}`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: slice.color }} />
                        <span className="flex-1 text-sm font-bold text-slate-700 dark:text-slate-300 truncate">{slice.name}</span>
                        <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 tabular-nums">{share.toFixed(0)}%</span>
                        <span className="text-sm font-black text-slate-900 dark:text-white tabular-nums">{euros(slice.value)}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="text-center py-12">
                <AlertCircle size={32} className="mx-auto text-slate-300 dark:text-slate-700 mb-3" />
                <p className="text-xs font-bold text-slate-400 dark:text-slate-600 uppercase tracking-widest">
                  {budgetTab === 'expense' ? 'Sin gastos en este periodo' : budgetTab === 'income' ? 'Sin ingresos en este periodo' : 'Sin aportaciones a huchas'}
                </p>
              </div>
            )}
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
      {/* grid-flow-row-dense: los bloques de una columna rellenan el hueco que deja uno ancho. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-min grid-flow-row-dense">{layout.map((key, idx) => { const isFullWidth = key === 'balance' || key === 'evolution'; return (<div key={key} className={`${isFullWidth ? 'md:col-span-2' : 'lg:col-span-1'} transition-all duration-300`}>{renderBlock(key, idx)}</div>); })}</div>
      {selectedBudgetForDetails && (
        <div className="fixed inset-0 bg-slate-900/90 z-[60] flex items-center justify-center p-4" onClick={() => setSelectedBudgetForDetails(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-[3rem] w-full max-w-lg p-8 md:p-10 shadow-2xl animate-in fade-in zoom-in duration-300 border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-8 flex-shrink-0"><div className="flex items-center gap-5"><div className="w-16 h-16 rounded-[1.5rem] flex items-center justify-center shadow-lg dark:shadow-none transition-colors" style={{ backgroundColor: `${selectedBudgetForDetails.color}${theme === 'dark' ? '30' : '15'}`, color: selectedBudgetForDetails.color }}>{ICON_MAP[selectedBudgetForDetails.icon] ? (React.cloneElement(ICON_MAP[selectedBudgetForDetails.icon] as React.ReactElement, { size: 28 })) : (<span className="text-3xl">{selectedBudgetForDetails.icon || <ShoppingBag size={28} />}</span>)}</div><div><h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{selectedBudgetForDetails.category}</h3><p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Movimientos de {currentDate}</p></div></div><button onClick={() => setSelectedBudgetForDetails(null)} className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400"><X size={24} /></button></div>
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-3xl p-6 mb-8 border border-slate-100 dark:border-slate-800 flex-shrink-0 transition-colors"><div className="flex justify-between items-end mb-4"><div><p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1">Total acumulado</p><p className="text-3xl font-black transition-colors" style={{ color: selectedBudgetForDetails.color }}>{selectedBudgetForDetails.spent.toLocaleString()}€</p></div><div className="text-right"><p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1">Límite</p><p className="text-lg font-bold text-slate-600 dark:text-slate-400 transition-colors">{selectedBudgetForDetails.limit.toLocaleString()}€</p></div></div><div className="w-full h-3 bg-white dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700"><div className="h-full rounded-full transition-all duration-1000" style={{ width: `${selectedBudgetForDetails.limit > 0 ? Math.min((selectedBudgetForDetails.spent / selectedBudgetForDetails.limit) * 100, 100) : 0}%`, background: `linear-gradient(90deg, ${selectedBudgetForDetails.color}40 0%, ${selectedBudgetForDetails.color} 100%)` }}></div></div></div>
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
