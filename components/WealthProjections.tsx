
import React, { useMemo, useState } from 'react';
import { useFinance } from '../App';
import { 
  TrendingUp, 
  Target, 
  ShieldCheck, 
  Zap, 
  ArrowUpRight, 
  Info,
  Calendar,
  Sparkles,
  HeartPulse,
  Plus,
  Trash2,
  Euro,
  RefreshCcw,
  Clock,
  PiggyBank,
  Calculator,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { ExtraSaving } from '../types';

const WealthProjections: React.FC = () => {
  const { 
    savings, 
    transactions, 
    currentDate, 
    theme, 
    accounts, 
    budgets,
    getSavingHistoricalBalance, 
    getAccountHistoricalBalance,
    // Context State & Methods
    extraSavings,
    manualContributions,
    addExtraSaving,
    deleteExtraSaving,
    updateManualContribution
  } = useFinance();
  
  // Estados de visibilidad de secciones
  const [showManualContributions, setShowManualContributions] = useState(false);
  const [showExtraEvents, setShowExtraEvents] = useState(false);

  // Ahorros extra (Form State)
  const [newExtraLabel, setNewExtraLabel] = useState('');
  const [newExtraAmount, setNewExtraAmount] = useState<number | ''>('');
  const [newExtraYear, setNewExtraYear] = useState(1);
  const [isRecurringExtra, setIsRecurringExtra] = useState(false);

  // MÉTRICAS DE SALUD Y PATRIMONIO REAL (Sincronizado con el resto de la App)
  const metrics = useMemo(() => {
    // 1. Patrimonio Total (Pilar de Seguridad)
    const totalInAccounts = accounts.reduce((acc, a) => acc + getAccountHistoricalBalance(a.id, currentDate), 0);
    const totalInSavings = savings.reduce((acc, s) => acc + getSavingHistoricalBalance(s.id, currentDate), 0);
    const netWorth = totalInAccounts + totalInSavings;

    // 2. Análisis del Flujo de este mes
    const monthTx = transactions.filter(t => t.date.startsWith(currentDate));
    const income = monthTx.filter(t => t.type === 'income' && !t.refundId).reduce((s, t) => s + t.amount, 0);
    const expense = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    
    // 3. Estimación de Coste de Vida (Burn Rate)
    // En lugar de usar solo el gasto de este mes (que puede ser engañoso), 
    // usamos la suma de los presupuestos definidos como gasto recurrente esperado.
    const totalMonthlyBudgetedExpense = budgets
      .filter(b => b.type === 'expense')
      .reduce((sum, b) => sum + b.limit, 0);
    
    // Usamos el mayor entre el gasto real y el presupuesto para ser conservadores
    const estimatedMonthlyBurnRate = Math.max(totalMonthlyBudgetedExpense, 500); // Mínimo 500€ de vida

    // 4. Tasa de Ahorro Inteligente
    // Si no hay ingresos este mes, comparamos el presupuesto de ingresos con el de gastos
    const budgetedIncome = budgets.filter(b => b.type === 'income').reduce((s, b) => s + b.limit, 0);
    const effectiveIncome = income > 0 ? income : budgetedIncome;
    const effectiveExpense = expense > 0 ? expense : totalMonthlyBudgetedExpense;
    
    const savingRate = effectiveIncome > 0 
      ? ((effectiveIncome - effectiveExpense) / effectiveIncome) * 100 
      : 0;

    // 5. Reserva Líquida (Meses de supervivencia)
    // Patrimonio Neto / Gasto Mensual Estimado
    const monthsCovered = netWorth / estimatedMonthlyBurnRate;

    // 6. Cálculo del Score (0-100)
    let score = 0;
    // Puntos por ahorro (máx 30)
    score += Math.max(0, Math.min(savingRate * 1.5, 30)); 
    // Puntos por reserva (máx 40): 12 meses o más = tope
    score += Math.min(monthsCovered * 3.3, 40); 
    // Puntos por solidez de patrimonio (máx 30): basado en múltiplos de 10k
    score += Math.min((netWorth / 10000) * 5, 30);

    return {
      score: Math.round(score),
      savingRate: Math.round(savingRate),
      monthsCovered: monthsCovered.toFixed(1),
      netWorth,
      totalInAccounts,
      totalInSavings
    };
  }, [transactions, currentDate, accounts, savings, budgets, getAccountHistoricalBalance, getSavingHistoricalBalance]);

  // LÓGICA DE PROYECCIÓN (AÑO 0 = NET WORTH REAL SINCRONIZADO)
  const projectionData = useMemo(() => {
    const data = [];
    let liquidCapital = metrics.totalInAccounts;
    
    let goalBalances = savings.reduce((acc, s) => ({
      ...acc,
      [s.id]: getSavingHistoricalBalance(s.id, currentDate)
    }), {} as Record<string, number>);

    for (let month = 0; month <= 240; month++) {
      const year = Math.floor(month / 12);
      const isYearStart = month % 12 === 0;

      savings.forEach(s => {
        const monthlyRate = ((s.growthRate || 0) / 100) / 12;
        // Use global state for contribution
        const monthlyContrib = manualContributions[s.id] || 0;
        goalBalances[s.id] = (goalBalances[s.id] * (1 + monthlyRate)) + monthlyContrib;
      });

      if (isYearStart && year > 0) {
        extraSavings.forEach(extra => {
          if (extra.isRecurring) {
            if (year >= extra.year) liquidCapital += extra.amount;
          } else if (year === extra.year) {
            liquidCapital += extra.amount;
          }
        });
      }

      if (isYearStart) {
        const totalSavingsYear = (Object.values(goalBalances) as number[]).reduce((a, b) => a + b, 0);
        data.push({
          year: year === 0 ? 'Hoy' : `${year}a`,
          fullYear: year === 0 ? 'Situación Actual' : `Año ${year}`,
          patrimonio: Math.round(liquidCapital + totalSavingsYear),
          soloHuchas: Math.round(totalSavingsYear),
          soloLiquido: Math.round(liquidCapital)
        });
      }
    }
    return data;
  }, [savings, extraSavings, manualContributions, metrics.totalInAccounts, getSavingHistoricalBalance, currentDate]);

  const handleAddExtraSaving = () => {
    if (!newExtraLabel || newExtraAmount === '') return;
    addExtraSaving({
      label: newExtraLabel,
      amount: Number(newExtraAmount),
      year: newExtraYear,
      isRecurring: isRecurringExtra
    });
    setNewExtraLabel('');
    setNewExtraAmount('');
    setNewExtraYear(1);
    setIsRecurringExtra(false);
  };

  const getScoreColor = (score: number) => {
    if (score > 80) return 'text-emerald-500';
    if (score > 50) return 'text-blue-500';
    return 'text-amber-500';
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20 max-w-7xl mx-auto px-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            Estrategia de Riqueza <Sparkles className="text-blue-500" size={24} />
          </h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium tracking-tight transition-colors">Análisis de capital proyectado a 20 años basado en tus datos reales.</p>
        </div>
        <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/30 px-6 py-3 rounded-2xl border border-blue-100 dark:border-blue-800 transition-colors">
          <Calculator className="text-blue-600 dark:text-blue-400" size={18} />
          <span className="text-blue-700 dark:text-blue-300 font-black text-xs uppercase tracking-widest leading-none">Cálculo en Tiempo Real</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Health Score Card */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 p-8 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col items-center text-center transition-all duration-300">
          <div className="relative mb-6">
            <div className="w-40 h-40 rounded-full border-[12px] border-slate-50 dark:border-slate-800 flex items-center justify-center shadow-inner transition-colors">
              <span className={`text-6xl font-black ${getScoreColor(metrics.score)}`}>{metrics.score}</span>
            </div>
            <div className="absolute -bottom-1 -right-1 bg-blue-600 text-white p-4 rounded-2xl shadow-xl">
              <HeartPulse size={24} />
            </div>
          </div>
          <h3 className="text-2xl font-black text-slate-800 dark:text-white mb-2 tracking-tight uppercase tracking-tighter transition-colors">Aura Health Score</h3>
          <p className="text-sm text-slate-400 dark:text-slate-500 mb-8 font-medium italic leading-relaxed transition-colors">Patrimonio base: <span className="text-slate-900 dark:text-white font-black">{metrics.netWorth.toLocaleString()}€</span></p>
          
          <div className="w-full space-y-3">
            <div className="flex justify-between p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800 transition-colors">
              <div className="flex items-center gap-3">
                <Target size={18} className="text-blue-500" />
                <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Tasa de Ahorro</span>
              </div>
              <span className="font-black text-lg transition-colors">{metrics.savingRate}%</span>
            </div>
            <div className="flex justify-between p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800 transition-colors">
              <div className="flex items-center gap-3">
                <ShieldCheck size={18} className="text-emerald-500" />
                <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Reserva Líquida</span>
              </div>
              <span className="font-black text-lg transition-colors">{metrics.monthsCovered} m</span>
            </div>
          </div>
        </div>

        {/* Projection Chart */}
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 p-6 md:p-10 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col transition-all duration-300 overflow-hidden">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
            <h3 className="font-black text-slate-800 dark:text-white text-xl flex items-center gap-3 tracking-tight uppercase tracking-tighter transition-colors">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/40 rounded-lg text-blue-600 dark:text-blue-400"><TrendingUp size={24} /></div>
              Evolución Patrimonial
            </h3>
            <div className="text-[10px] font-black bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-xl text-slate-500 dark:text-slate-400 uppercase tracking-widest transition-colors">
              Hoy: {metrics.netWorth.toLocaleString()}€
            </div>
          </div>
          
          <div className="w-full h-[350px] md:h-[450px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={projectionData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorWealth" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="6 6" vertical={false} stroke={theme === 'dark' ? '#1e293b' : '#f1f5f9'} />
                <XAxis 
                    dataKey="year" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fontSize: 10, fill: theme === 'dark' ? '#64748b' : '#94a3b8', fontWeight: 800}} 
                    interval={window.innerWidth < 768 ? 4 : 2}
                />
                <YAxis 
                  axisLine={false}
                  tickLine={false}
                  tick={{fontSize: 10, fill: theme === 'dark' ? '#64748b' : '#94a3b8', fontWeight: 800}}
                  tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`}
                />
                <Tooltip 
                  cursor={{ stroke: '#3b82f6', strokeWidth: 2, strokeDasharray: '6 6' }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-800 animate-in zoom-in duration-200">
                          <p className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-3">{data.fullYear}</p>
                          <div className="space-y-2">
                             <div className="flex justify-between gap-8 items-center">
                               <span className="text-xs font-bold text-slate-400 uppercase">Patrimonio Total</span>
                               <span className="text-xl font-black text-slate-900 dark:text-white">{data.patrimonio.toLocaleString()}€</span>
                             </div>
                             <div className="h-px bg-slate-100 dark:bg-slate-800 w-full" />
                             <div className="flex justify-between gap-8 items-center text-[10px]">
                               <span className="font-bold text-slate-400 uppercase tracking-tighter">Huchas + Inversión</span>
                               <span className="font-black text-slate-700 dark:text-slate-300">{data.soloHuchas.toLocaleString()}€</span>
                             </div>
                             <div className="flex justify-between gap-8 items-center text-[10px]">
                               <span className="font-bold text-slate-400 uppercase tracking-tighter">Saldo en Cuentas</span>
                               <span className="font-black text-slate-700 dark:text-slate-300">{data.soloLiquido.toLocaleString()}€</span>
                             </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area 
                  type="monotone" 
                  dataKey="patrimonio" 
                  stroke="#3b82f6" 
                  strokeWidth={5} 
                  fill="url(#colorWealth)" 
                  animationDuration={1200}
                  dot={false}
                  activeDot={{ r: 8, strokeWidth: 0, fill: '#3b82f6' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Manual Monthly Contributions (COLLAPSIBLE) */}
      <div className="bg-white dark:bg-slate-900 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-sm transition-all duration-300 overflow-hidden">
        <button 
          onClick={() => setShowManualContributions(!showManualContributions)}
          className="w-full flex items-center justify-between p-8 md:p-10 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-50 dark:bg-blue-900/40 rounded-2xl text-blue-600 dark:text-blue-400"><PiggyBank size={28} /></div>
            <div className="text-left">
              <h3 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight uppercase tracking-tighter transition-colors">Aportación Mensual Manual</h3>
              <p className="text-sm text-slate-400 dark:text-slate-500 font-medium italic transition-colors">Define con precisión cuánto destinarás a cada hucha mes a mes.</p>
            </div>
          </div>
          <div className={`p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 transition-transform duration-300 ${showManualContributions ? 'rotate-180' : ''}`}>
            <ChevronDown size={24} />
          </div>
        </button>

        {showManualContributions && (
          <div className="p-8 md:p-10 pt-0 animate-in slide-in-from-top-4 duration-300">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {savings.map(s => (
                <div key={s.id} className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-700 group hover:border-blue-200 dark:hover:border-blue-800 transition-all">
                  <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white dark:bg-slate-900 rounded-xl flex items-center justify-center text-xl shadow-sm group-hover:scale-110 transition-transform">
                        {s.emoji || '💰'}
                      </div>
                      <span className="font-black text-sm text-slate-700 dark:text-slate-200 uppercase tracking-tight line-clamp-1 transition-colors">{s.name}</span>
                    </div>
                    {s.growthRate && (
                      <span className="text-[9px] font-black bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded-lg">+{s.growthRate}% Anual</span>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest pl-1">Ahorro Mensual (€)</label>
                    <div className="relative">
                      <input 
                        type="number" 
                        value={manualContributions[s.id] || 0}
                        onChange={(e) => updateManualContribution(s.id, Number(e.target.value))}
                        className="w-full bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 rounded-2xl p-4 font-black text-xl text-slate-800 dark:text-white outline-none focus:border-blue-500 transition-all"
                        placeholder="0"
                      />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 dark:text-slate-600 font-black">€</div>
                    </div>
                  </div>
                </div>
              ))}
              {savings.length === 0 && (
                <div className="col-span-full py-12 text-center border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-[2.5rem]">
                   <p className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-sm transition-colors">Crea huchas en la sección de Ahorro para empezar la proyección.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Extra Savings Section (COLLAPSIBLE) */}
      <div className="bg-white dark:bg-slate-900 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-sm transition-all duration-300 overflow-hidden">
        <button 
          onClick={() => setShowExtraEvents(!showExtraEvents)}
          className="w-full flex items-center justify-between p-8 md:p-10 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-50 dark:bg-amber-900/40 rounded-2xl text-amber-500"><Euro size={28} /></div>
            <div className="text-left">
                <h3 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight uppercase tracking-tighter transition-colors">Eventos de Capital Extra</h3>
                <p className="text-sm text-slate-400 dark:text-slate-500 font-medium italic transition-colors">Añade bonus, herencias o ventas de activos proyectadas.</p>
            </div>
          </div>
          <div className={`p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 transition-transform duration-300 ${showExtraEvents ? 'rotate-180' : ''}`}>
            <ChevronDown size={24} />
          </div>
        </button>

        {showExtraEvents && (
          <div className="p-8 md:p-10 pt-0 animate-in slide-in-from-top-4 duration-300">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8 bg-slate-50 dark:bg-slate-800/50 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 transition-colors">
                <div className="md:col-span-2 space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase pl-1">Concepto del Ingreso</label>
                    <input 
                        type="text" 
                        placeholder="Ej: Bonus Anual" 
                        value={newExtraLabel}
                        onChange={(e) => setNewExtraLabel(e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                    />
                </div>
                <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase pl-1">Monto (€)</label>
                    <input 
                        type="number" 
                        placeholder="1000" 
                        value={newExtraAmount}
                        onChange={(e) => setNewExtraAmount(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                    />
                </div>
                <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase pl-1">Año de Inicio</label>
                    <select 
                        value={newExtraYear}
                        onChange={(e) => setNewExtraYear(Number(e.target.value))}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500 appearance-none transition-colors"
                    >
                        {Array.from({length: 20}, (_, i) => i + 1).map(y => (
                            <option key={y} value={y} className="dark:bg-slate-900">Año {y}</option>
                        ))}
                    </select>
                </div>
                <div className="flex flex-col justify-end">
                    <button 
                      type="button"
                      onClick={() => setIsRecurringExtra(!isRecurringExtra)}
                      className={`flex items-center justify-center gap-2 p-4 rounded-2xl font-black text-[10px] border-2 transition-all ${isRecurringExtra ? 'bg-indigo-50 border-indigo-200 text-indigo-600 dark:bg-indigo-900/40 dark:border-indigo-800 dark:text-indigo-400' : 'bg-white border-slate-200 text-slate-400 dark:bg-slate-800 dark:border-slate-700'}`}
                    >
                      {isRecurringExtra ? <RefreshCcw size={14} className="animate-spin-slow" /> : <Clock size={14} />}
                      {isRecurringExtra ? 'RECURRENTE' : 'PUNTUAL'}
                    </button>
                </div>
                <div className="md:col-span-5">
                  <button 
                      onClick={handleAddExtraSaving}
                      disabled={!newExtraLabel || newExtraAmount === ''}
                      className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-2xl shadow-xl shadow-blue-100 dark:shadow-none transition-all disabled:opacity-50 flex items-center justify-center gap-2 uppercase tracking-widest text-[11px]"
                  >
                      <Plus size={18} /> AGREGAR A LA ESTRATEGIA AURA
                  </button>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {extraSavings.map(extra => (
                    <div key={extra.id} className="bg-white dark:bg-slate-800 p-5 rounded-[1.8rem] border border-slate-100 dark:border-slate-700 flex justify-between items-center group hover:border-blue-200 dark:hover:border-blue-800 transition-all shadow-sm">
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate">{extra.label}</p>
                              {extra.isRecurring && <RefreshCcw size={10} className="text-indigo-500 shrink-0" />}
                            </div>
                            <div className="flex items-baseline gap-2">
                                <span className="text-xl font-black text-slate-800 dark:text-white">+{extra.amount.toLocaleString()}€</span>
                                <span className="text-[9px] font-bold text-blue-500 uppercase tracking-tighter whitespace-nowrap">Año {extra.year}{extra.isRecurring ? '+' : ''}</span>
                            </div>
                        </div>
                        <button 
                            onClick={() => deleteExtraSaving(extra.id)}
                            className="p-2 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all"
                        >
                            <Trash2 size={18} />
                        </button>
                    </div>
                ))}
                {extraSavings.length === 0 && (
                    <div className="col-span-full py-10 text-center border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-[2rem]">
                        <p className="text-slate-400 dark:text-slate-500 font-bold italic text-sm uppercase tracking-[0.15em] transition-colors">Sin eventos de capital extraordinario registrados.</p>
                    </div>
                )}
            </div>
          </div>
        )}
      </div>

      {/* Strategy Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        {[
          { label: 'En 1 año', val: projectionData[1]?.patrimonio || 0, icon: <Calendar />, color: 'text-slate-600 dark:text-slate-300' },
          { label: 'En 5 años', val: projectionData[5]?.patrimonio || 0, icon: <TrendingUp />, color: 'text-blue-600 dark:text-blue-400' },
          { label: 'En 10 años', val: projectionData[10]?.patrimonio || 0, icon: <Zap />, color: 'text-amber-500' },
          { label: 'En 20 años', val: projectionData[20]?.patrimonio || 0, icon: <Sparkles />, color: 'text-indigo-500' }
        ].map((item, i) => (
          <div key={i} className="bg-white dark:bg-slate-900 p-5 md:p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col gap-3 transition-all duration-300 hover:shadow-md">
            <div className={`w-10 h-10 md:w-12 md:h-12 rounded-[1.2rem] bg-slate-50 dark:bg-slate-800 flex items-center justify-center ${item.color} transition-colors`}>
              {item.icon}
            </div>
            <div>
              <p className="text-[9px] md:text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">{item.label}</p>
              <p className="text-xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tighter transition-colors">{item.val.toLocaleString()}€</p>
            </div>
            <div className="hidden md:flex items-center gap-1 text-[10px] font-black text-emerald-500 uppercase tracking-widest transition-colors">
              <ArrowUpRight size={14} />
              Previsión Aura
            </div>
          </div>
        ))}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .animate-spin-slow {
          animation: spin 6s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}} />
    </div>
  );
};

export default WealthProjections;
