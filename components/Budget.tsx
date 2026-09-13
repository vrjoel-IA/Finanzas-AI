import React, { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useFinance } from '../App';
import {
  Plus,
  Edit2,
  Trash2,
  ChevronRight,
  X,
  TrendingDown,
  TrendingUp,
  AlertCircle,
  Calendar,
  Tag,
  ChevronDown,
  History,
  ArrowRight,
  Palette,
  Check,
  Undo2,
  Copy,
  PiggyBank,
} from 'lucide-react';
import { Saving } from '../types';
import { CATEGORIES, INCOME_CATEGORIES, ICON_MAP, BUDGET_PRESET_COLORS } from '../constants';
import { aggregatePeriod, categorySpent, periodHeadline, savingFlow } from '../services/periodIndex';
import { isMonthKey } from '../services/periods';
import { budgetKey, budgetStatus } from '../services/budgetPlan';
import type { BudgetType, EffectiveBudget } from '../services/budgetPlan';
import { budgetBadgeLabel, budgetBadgeTone, budgetCardTone } from './budgetTone';

type Tab = BudgetType;

const TABS: Tab[] = ['expense', 'income', 'saving'];
const SAVING_COLOR = '#f59e0b';
const NEW_SAVING = '__new__';

/** Tarjeta unificada: un presupuesto de gasto o ingreso, o una hucha con o sin objetivo. */
interface BudgetCard {
  key: string;
  type: Tab;
  category: string;
  icon: string;
  color: string;
  limit: number;
  spent: number;
  totalRefunded: number;
  withdrawals: number;
  /** Presupuesto efectivo del mes. null = hucha sin objetivo mensual. */
  budget: EffectiveBudget | null;
  saving?: Saving;
}

const readTab = (state: unknown): Tab | null => {
  const tab = state && typeof state === 'object' ? (state as { tab?: unknown }).tab : undefined;
  return TABS.indexOf(tab as Tab) !== -1 ? (tab as Tab) : null;
};

const BudgetManager: React.FC = () => {
  const {
    budgets, transactions, savings, currentDate, accounts, theme, viewIndex,
    importBudgetFromMonth, undoBudgetChange, budgetUndoCount, getPeriodsWithBudgets, getEffectiveBudgets,
    saveBudgetInPeriod, removeBudgetFromPeriod, addSaving,
  } = useFinance();
  const location = useLocation();
  const isMonthView = isMonthKey(currentDate);

  // UI States. La pestaña puede venir fijada desde el dashboard.
  const [activeTab, setActiveTab] = useState<Tab>(() => readTab(location.state) || 'expense');
  const [selectedCard, setSelectedCard] = useState<BudgetCard | null>(null);
  const [formCard, setFormCard] = useState<BudgetCard | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [undoToast, setUndoToast] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Form States
  const [category, setCategory] = useState('');
  const [limit, setLimit] = useState<number | ''>('');
  const [customCategory, setCustomCategory] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState('ShoppingBag');
  const [selectedColor, setSelectedColor] = useState('#3b82f6');
  const [savingChoice, setSavingChoice] = useState('');
  const [newSavingName, setNewSavingName] = useState('');
  const [newSavingEmoji, setNewSavingEmoji] = useState('💰');
  const [newSavingTarget, setNewSavingTarget] = useState<number | ''>('');

  useEffect(() => {
    const tab = readTab(location.state);
    if (tab) setActiveTab(tab);
  }, [location.state]);

  // Los presupuestos del periodo se derivan: si el mes no tiene los suyos, se
  // heredan del mismo mes del anio anterior (si fue un mes normal) o del mes
  // anterior. La herencia es invisible para el usuario: puede editar, borrar o
  // anadir sobre ella y el mes se guarda como propio en ese mismo momento.
  const periodBudgets = useMemo(
    () => getEffectiveBudgets(currentDate),
    [getEffectiveBudgets, currentDate],
  );

  const agg = useMemo(() => aggregatePeriod(viewIndex, currentDate), [viewIndex, currentDate]);

  const cards = useMemo<BudgetCard[]>(() => {
    if (activeTab === 'saving') {
      return savings.map(s => {
        const budget = periodBudgets.filter(b => b.type === 'saving' && b.savingId === s.id)[0] || null;
        const flow = savingFlow(viewIndex, s.id, currentDate);
        return {
          key: budgetKey({ type: 'saving', category: s.name, savingId: s.id }),
          type: 'saving' as Tab,
          category: s.name,
          icon: s.emoji || (s.isInvestment ? '📈' : '💰'),
          color: s.color || SAVING_COLOR,
          limit: budget ? budget.limit : 0,
          spent: flow.deposits,
          totalRefunded: 0,
          withdrawals: flow.withdrawals,
          budget,
          saving: s,
        };
      });
    }
    return periodBudgets
      .filter(b => (b.type || 'expense') === activeTab)
      .map(b => {
        const flow = agg.byCategory[b.category];
        return {
          key: budgetKey(b),
          type: activeTab,
          category: b.category,
          icon: b.icon,
          color: b.color || '#3b82f6',
          limit: b.limit,
          spent: categorySpent(agg, b.category, activeTab === 'income' ? 'income' : 'expense'),
          totalRefunded: flow ? flow.refunded : 0,
          withdrawals: 0,
          budget: b,
        };
      });
  }, [activeTab, savings, periodBudgets, viewIndex, currentDate, agg]);

  const totals = useMemo(() => {
    const withGoal = cards.filter(c => c.budget);
    const limitSum = withGoal.reduce((s, c) => s + c.limit, 0);
    if (activeTab === 'saving') {
      const assigned = cards.reduce((s, c) => s + c.spent, 0);
      const saved = periodHeadline(agg).saving;
      return {
        limit: limitSum,
        // Mismo dato que "Ahorro" en el widget principal del dashboard.
        actual: saved,
        pending: withGoal.reduce((s, c) => s + Math.max(0, c.limit - c.spent), 0),
        unassigned: Math.max(0, saved - assigned),
      };
    }
    const actual = withGoal.reduce((s, c) => s + c.spent, 0);
    return {
      limit: limitSum,
      actual,
      pending: activeTab === 'income' ? Math.max(0, limitSum - actual) : limitSum - actual,
      unassigned: 0,
    };
  }, [cards, activeTab, agg]);

  const detailTransactions = useMemo(() => {
    if (!selectedCard) return [];
    return transactions
      .filter(t => t.date.startsWith(currentDate) && (selectedCard.type === 'saving'
        ? t.savingId === selectedCard.saving?.id
        : t.category === selectedCard.category))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [selectedCard, transactions, currentDate]);

  // Periodos disponibles para importar (excluir el actual)
  const availableImportPeriods = useMemo(() => {
    return getPeriodsWithBudgets().filter(p => p !== currentDate);
  }, [getPeriodsWithBudgets, currentDate]);

  const savingsWithoutGoal = useMemo(
    () => savings.filter(s => !periodBudgets.some(b => b.type === 'saving' && b.savingId === s.id)),
    [savings, periodBudgets],
  );

  const resetForm = () => {
    setCategory('');
    setLimit('');
    setCustomCategory('');
    setIsCustomMode(false);
    setSelectedIcon('ShoppingBag');
    setSelectedColor('#3b82f6');
    setSavingChoice('');
    setNewSavingName('');
    setNewSavingEmoji('💰');
    setNewSavingTarget('');
    setFormError(null);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setFormCard(null);
    resetForm();
  };

  const openCreate = (preset?: BudgetCard) => {
    // En vista anual currentDate es 'YYYY' y el presupuesto naceria invisible en
    // todos los meses. Mejor mandar al usuario a un mes concreto.
    if (!isMonthView) return;
    resetForm();
    if (activeTab === 'saving') {
      const first = preset?.saving || savingsWithoutGoal[0];
      setSavingChoice(first ? first.id : NEW_SAVING);
    } else {
      const defaultCats = activeTab === 'expense' ? CATEGORIES : INCOME_CATEGORIES;
      setCategory(defaultCats[0].name);
      setSelectedIcon(defaultCats[0].icon);
      setSelectedColor(defaultCats[0].color);
    }
    setFormCard(null);
    setIsFormOpen(true);
  };

  const openEdit = (card: BudgetCard) => {
    if (!isMonthView) return;
    resetForm();
    if (card.type === 'saving') {
      setSavingChoice(card.saving ? card.saving.id : NEW_SAVING);
    } else {
      const defaultCats = card.type === 'expense' ? CATEGORIES : INCOME_CATEGORIES;
      const isStandard = defaultCats.some(c => c.name === card.category);
      setCategory(isStandard ? card.category : 'Otra');
      setCustomCategory(isStandard ? '' : card.category);
      setIsCustomMode(!isStandard);
      setSelectedIcon(card.icon);
      setSelectedColor(card.color || '#3b82f6');
    }
    setLimit(card.limit);
    setFormCard(card);
    setIsFormOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (limit === '') return;
    const original = formCard && formCard.budget ? formCard.budget : null;

    if (activeTab === 'saving') {
      let saving = savings.filter(s => s.id === savingChoice)[0];
      let savingId = savingChoice;
      if (savingChoice === NEW_SAVING) {
        const name = newSavingName.trim();
        if (!name) { setFormError('Ponle un nombre a la hucha.'); return; }
        const draft = {
          name,
          currentAmount: 0,
          targetAmount: newSavingTarget === '' ? undefined : Number(newSavingTarget),
          isInvestment: false,
          color: SAVING_COLOR,
          emoji: newSavingEmoji || '💰',
        };
        savingId = addSaving(draft);
        saving = { ...draft, id: savingId };
      }
      if (!saving) { setFormError('Elige una hucha.'); return; }
      saveBudgetInPeriod(currentDate, original, {
        category: saving.name,
        limit: Number(limit),
        icon: saving.emoji || '💰',
        color: saving.color || SAVING_COLOR,
        type: 'saving',
        savingId,
      });
      closeForm();
      return;
    }

    const finalCategory = (isCustomMode ? customCategory : category).trim();
    if (!finalCategory) return;
    const ok = saveBudgetInPeriod(currentDate, original, {
      category: finalCategory,
      limit: Number(limit),
      icon: selectedIcon,
      color: selectedColor,
      type: activeTab,
    });
    if (!ok) {
      setFormError(`Ya hay otra categoría "${finalCategory}" en este mes.`);
      return;
    }
    closeForm();
  };

  const handleDeleteClick = (e: React.MouseEvent, card: BudgetCard) => {
    e.stopPropagation();
    if (!card.budget) return;
    if (deletingKey === card.key) {
      removeBudgetFromPeriod(currentDate, card.budget);
      setDeletingKey(null);
    } else {
      setDeletingKey(card.key);
      setTimeout(() => {
        setDeletingKey(prev => prev === card.key ? null : prev);
      }, 3000);
    }
  };

  const handleImport = (sourceDate: string) => {
    importBudgetFromMonth(sourceDate, currentDate);
    setShowImportModal(false);
  };

  const handleUndo = () => {
    const result = undoBudgetChange();
    setConfirmUndo(false);
    if (result) {
      setUndoToast(`Deshecho: ${result.label}`);
      setTimeout(() => setUndoToast(null), 3000);
    }
  };

  const formatPeriodLabel = (period: string) => {
    if (!period.includes('-')) return period;
    const [y, m] = period.split('-');
    const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    return `${months[parseInt(m) - 1]} ${y}`;
  };

  const euros = (value: number) => `${Math.round(value).toLocaleString('es-ES')}€`;

  const renderIcon = (icon: string, size: number) => ICON_MAP[icon]
    ? React.cloneElement(ICON_MAP[icon] as React.ReactElement, { size })
    : <span className={size > 24 ? 'text-3xl' : 'text-2xl'}>{icon || <Tag size={size} />}</span>;

  const tabButton = (tab: Tab, label: string, icon: React.ReactNode, activeTone: string) => (
    <button
      onClick={() => { setActiveTab(tab); setDeletingKey(null); }}
      className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-4 md:px-8 py-3 text-xs font-black rounded-2xl transition-all ${activeTab === tab ? `bg-white dark:bg-slate-700 shadow-md ${activeTone}` : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
    >
      {icon} {label}
    </button>
  );

  const tabColor = activeTab === 'expense' ? '#f43f5e' : activeTab === 'income' ? '#10b981' : SAVING_COLOR;
  const totalLabels = activeTab === 'expense'
    ? ['Presupuestado', 'Consumido', totals.pending < 0 ? 'Excedido' : 'Disponible']
    : activeTab === 'income'
      ? ['Objetivo', 'Ingresado', 'Falta']
      : ['Objetivo', 'Aportado', 'Falta'];
  const totalProgress = totals.limit > 0 ? Math.min((totals.actual / totals.limit) * 100, 100) : 0;
  const hasExpenseOrIncome = periodBudgets.some(b => b.type !== 'saving');
  const showList = activeTab === 'saving' ? savings.length > 0 : cards.length > 0;

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-20 px-2 md:px-0 transition-colors">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-black text-slate-800 dark:text-white tracking-tight">Presupuestos</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium text-xs md:text-sm tracking-tight transition-colors">Controla tus finanzas de {formatPeriodLabel(currentDate)} con precisión.</p>
        </div>
        <div className="flex gap-1.5 md:gap-2 items-center flex-shrink-0">
          {budgetUndoCount > 0 && (
            confirmUndo ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleUndo}
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
          {activeTab !== 'saving' && (
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-1.5 p-3 md:px-5 md:py-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-black rounded-xl md:rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm active:scale-95"
              title="Importar de otro mes"
            >
              <Copy size={18} className="text-violet-500" />
              <span className="hidden md:inline text-sm">Importar</span>
            </button>
          )}
          <button
            onClick={() => openCreate()}
            disabled={!isMonthView}
            title={!isMonthView ? 'Cambia a vista mensual para crear un presupuesto' : undefined}
            className="flex items-center gap-1.5 px-4 py-3 md:px-8 md:py-4 bg-blue-600 text-white font-black text-sm rounded-xl md:rounded-2xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 dark:shadow-none active:scale-95 disabled:opacity-50"
          >
            <Plus size={18} />
            <span>Nuevo</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-3xl w-full md:w-fit border border-slate-200 dark:border-slate-700 shadow-inner">
        {tabButton('expense', 'GASTOS', <TrendingDown size={16} />, 'text-rose-600 dark:text-rose-400')}
        {tabButton('income', 'INGRESOS', <TrendingUp size={16} />, 'text-emerald-600 dark:text-emerald-400')}
        {tabButton('saving', 'AHORROS', <PiggyBank size={16} />, 'text-amber-600 dark:text-amber-400')}
      </div>

      {!isMonthView && (periodBudgets.length > 0 || activeTab === 'saving') && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
          <Calendar size={18} className="text-slate-400 shrink-0" />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Vista anual: los límites son la suma de los doce meses y no se pueden editar aquí. Cambia a vista mensual para modificarlos.
          </p>
        </div>
      )}

      {/* Estados vacios */}
      {activeTab !== 'saving' && !hasExpenseOrIncome && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-[2.5rem] border-2 border-dashed border-slate-200 dark:border-slate-700 p-10 md:p-16 text-center transition-colors">
          <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Calendar size={28} className="text-slate-400 dark:text-slate-600" />
          </div>
          <h3 className="text-lg font-black text-slate-800 dark:text-white mb-2">Sin presupuesto para {formatPeriodLabel(currentDate)}</h3>
          <p className="text-sm text-slate-400 dark:text-slate-500 mb-6 max-w-md mx-auto">
            Crea tus categorías o importa la configuración de otro mes. Los meses siguientes la usarán automáticamente.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => openCreate()}
              disabled={!isMonthView}
              title={!isMonthView ? 'Cambia a vista mensual para crear un presupuesto' : undefined}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-700 transition-all shadow-lg active:scale-95"
            >
              <Plus size={18} /> Crear Categoría
            </button>
            {availableImportPeriods.length > 0 && (
              <button
                onClick={() => setShowImportModal(true)}
                className="flex items-center justify-center gap-2 px-6 py-3 bg-white dark:bg-slate-800 text-violet-600 dark:text-violet-400 font-black border-2 border-violet-200 dark:border-violet-800 rounded-2xl hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all active:scale-95"
              >
                <Copy size={18} /> Importar de otro mes
              </button>
            )}
          </div>
        </div>
      )}

      {activeTab !== 'saving' && hasExpenseOrIncome && cards.length === 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-[2.5rem] border-2 border-dashed border-slate-200 dark:border-slate-700 p-10 text-center transition-colors">
          <p className="text-sm font-black text-slate-500 dark:text-slate-400 mb-1">
            {activeTab === 'expense' ? 'Sin presupuestos de gasto' : 'Sin presupuestos de ingreso'}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Pulsa "Nuevo" para añadir uno a {formatPeriodLabel(currentDate)}.
          </p>
        </div>
      )}

      {activeTab === 'saving' && savings.length === 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-[2.5rem] border-2 border-dashed border-amber-200 dark:border-amber-900/60 p-10 md:p-16 text-center transition-colors">
          <div className="w-16 h-16 bg-amber-50 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <PiggyBank size={28} className="text-amber-500" />
          </div>
          <h3 className="text-lg font-black text-slate-800 dark:text-white mb-2">Aún no tienes huchas</h3>
          <p className="text-sm text-slate-400 dark:text-slate-500 mb-6 max-w-md mx-auto">
            Crea una hucha y fija cuánto quieres apartar cada mes. También aparecerá en Huchas.
          </p>
          <button
            onClick={() => openCreate()}
            disabled={!isMonthView}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-amber-500 text-white font-black rounded-2xl hover:bg-amber-600 transition-all shadow-lg active:scale-95 disabled:opacity-50"
          >
            <Plus size={18} /> Crear hucha
          </button>
        </div>
      )}

      {showList && (
        <>
          {/* Totales compactos: tres cifras y una barra, en una sola tarjeta */}
          <div className="bg-white dark:bg-slate-900 px-4 py-4 md:px-6 md:py-5 rounded-2xl md:rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm transition-colors">
            <div className="grid grid-cols-3 gap-2 md:gap-6">
              <div className="min-w-0">
                <p className="text-[9px] md:text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest truncate">{totalLabels[0]}</p>
                <p className="text-base md:text-2xl font-black text-slate-800 dark:text-white tabular-nums truncate">{euros(totals.limit)}</p>
              </div>
              <div className="min-w-0 text-center">
                <p className="text-[9px] md:text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest truncate">{totalLabels[1]}</p>
                <p className="text-base md:text-2xl font-black tabular-nums truncate" style={{ color: tabColor }}>{euros(totals.actual)}</p>
              </div>
              <div className="min-w-0 text-right">
                <p className="text-[9px] md:text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest truncate">{totalLabels[2]}</p>
                <p className={`text-base md:text-2xl font-black tabular-nums truncate ${totals.pending < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-white'}`}>{euros(Math.abs(totals.pending))}</p>
              </div>
            </div>
            <div className="mt-3 w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${totalProgress}%`, backgroundColor: tabColor }} />
            </div>
            {totals.unassigned > 0.005 && (
              <p className="mt-2 text-[10px] font-bold text-slate-400 dark:text-slate-500">
                Incluye {euros(totals.unassigned)} de ahorro sin hucha asignada.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {cards.map(card => {
              const hasGoal = !!card.budget;
              const progress = card.limit > 0 ? Math.min((card.spent / card.limit) * 100, 100) : 0;
              const status = hasGoal ? budgetStatus({ type: card.type, spent: card.spent, limit: card.limit }) : 'normal';
              const badgeTone = budgetBadgeTone(card.type, status);
              const isConfirmingDelete = deletingKey === card.key;
              const canEdit = isMonthView;

              return (
                <div
                  key={card.key}
                  onClick={() => setSelectedCard(card)}
                  className={`rounded-2xl md:rounded-[2.5rem] p-6 md:p-8 border shadow-sm hover:shadow-md transition-all group cursor-pointer active:scale-[0.99] duration-300 ${budgetCardTone(card.type, status)}`}
                >
                  <div className="flex justify-between items-start mb-6">
                    <div className="flex items-center gap-3 md:gap-4 min-w-0">
                      <div
                        className="w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center shadow-inner dark:shadow-none transition-colors shrink-0"
                        style={{ backgroundColor: `${card.color}${theme === 'dark' ? '30' : '15'}`, color: card.color }}
                      >
                        {renderIcon(card.icon, 24)}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-base md:text-lg font-black text-slate-800 dark:text-white tracking-tight transition-colors truncate">{card.category}</h4>
                        <p className="text-xs text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">{card.type === 'expense' ? 'Gasto' : card.type === 'income' ? 'Ingreso' : 'Ahorro mensual'}</p>
                      </div>
                    </div>
                    {canEdit && hasGoal && (
                      <div className="flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-all">
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(card); }}
                          className="p-2.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/40 rounded-xl transition-colors"
                          title="Editar"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={(e) => handleDeleteClick(e, card)}
                          className={`p-2.5 rounded-xl transition-all flex items-center gap-1 ${
                            isConfirmingDelete
                              ? 'bg-rose-600 text-white animate-pulse'
                              : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/40'
                          }`}
                          title={card.type === 'saving' ? 'Quitar objetivo de este mes' : 'Eliminar de este mes'}
                        >
                          {isConfirmingDelete ? (
                            <>
                              <Check size={18} />
                              <span className="text-[10px] font-black uppercase">¿Quitar?</span>
                            </>
                          ) : (
                            <Trash2 size={18} />
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-5">
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-3xl md:text-4xl font-black tracking-tight transition-colors" style={{ color: card.color }}>{card.spent.toLocaleString('es-ES')}€</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-black uppercase tracking-widest transition-colors">
                          {hasGoal
                            ? `de ${card.limit.toLocaleString('es-ES')}€ ${card.type === 'expense' ? 'definidos' : 'objetivo'}`
                            : 'aportado este mes · sin objetivo'}
                        </p>
                      </div>
                      {hasGoal && (
                        <div className="text-right">
                          <span
                            style={badgeTone ? undefined : { backgroundColor: `${card.color}${theme === 'dark' ? '30' : '15'}`, color: card.color }}
                            className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-colors ${badgeTone}`}
                          >
                            {budgetBadgeLabel(card.type, status, progress)}
                          </span>
                        </div>
                      )}
                    </div>
                    {hasGoal && (
                      <div className="w-full bg-slate-100 dark:bg-slate-800 h-3 rounded-full overflow-hidden transition-colors">
                        <div
                          className="h-full rounded-full transition-all duration-1000 ease-out"
                          style={{
                            width: `${progress}%`,
                            background: `linear-gradient(90deg, ${card.color}40 0%, ${card.color} 100%)`,
                          }}
                        ></div>
                      </div>
                    )}

                    {card.totalRefunded > 0 && (
                      <p className="text-[10px] font-black flex items-center gap-1.5 transition-all" style={{ color: card.color }}>
                        <ChevronRight size={12} className="shrink-0" />
                        Reembolsado: +{card.totalRefunded.toLocaleString('es-ES')}€ (Ahorro en gasto neto)
                      </p>
                    )}
                    {card.withdrawals > 0 && (
                      <p className="text-[10px] font-black text-slate-400 dark:text-slate-500">Retirado este mes: {card.withdrawals.toLocaleString('es-ES')}€</p>
                    )}

                    <div className="flex items-center justify-between border-t border-slate-100/70 dark:border-slate-800 pt-3">
                      <p className="text-xs text-slate-400 dark:text-slate-500 font-bold flex items-center gap-1 transition-colors"><ChevronRight size={14} style={{ color: card.color }} /> Ver detalles</p>
                      {!hasGoal && canEdit && (
                        <button
                          onClick={(e) => { e.stopPropagation(); openCreate(card); }}
                          className="text-xs font-black text-amber-600 dark:text-amber-400 hover:underline underline-offset-4"
                        >
                          Fijar objetivo
                        </button>
                      )}
                      {hasGoal && card.type === 'expense' && card.limit > card.spent && (
                        <p className="text-xs font-black text-slate-700 dark:text-slate-300 transition-colors">Dispones de {(card.limit - card.spent).toLocaleString('es-ES')}€ más</p>
                      )}
                      {hasGoal && card.type !== 'expense' && card.limit > card.spent && (
                        <p className="text-xs font-black text-slate-700 dark:text-slate-300 transition-colors">Faltan {(card.limit - card.spent).toLocaleString('es-ES')}€</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Modal Ver Detalles */}
      {selectedCard && (
        <div className="fixed inset-0 bg-slate-900/90 z-[60] flex items-center justify-center p-4" onClick={() => setSelectedCard(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-[3rem] w-full max-w-lg p-8 md:p-10 shadow-2xl animate-in fade-in zoom-in duration-300 border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-8 flex-shrink-0">
              <div className="flex items-center gap-5">
                <div
                  className="w-16 h-16 rounded-[1.5rem] flex items-center justify-center shadow-lg dark:shadow-none transition-colors"
                  style={{ backgroundColor: `${selectedCard.color}${theme === 'dark' ? '30' : '15'}`, color: selectedCard.color }}
                >
                  {renderIcon(selectedCard.icon, 28)}
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{selectedCard.category}</h3>
                  <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Movimientos de {currentDate}</p>
                </div>
              </div>
              <button onClick={() => setSelectedCard(null)} className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400"><X size={24} /></button>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-3xl p-6 mb-8 border border-slate-100 dark:border-slate-800 flex-shrink-0 transition-colors">
              <div className="flex justify-between items-end mb-4">
                <div>
                  <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1">Total acumulado</p>
                  <p className="text-3xl font-black transition-colors" style={{ color: selectedCard.color }}>{selectedCard.spent.toLocaleString('es-ES')}€</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase mb-1">{selectedCard.type === 'expense' ? 'Límite' : 'Objetivo'}</p>
                  <p className="text-lg font-bold text-slate-600 dark:text-slate-400 transition-colors">{selectedCard.budget ? `${selectedCard.limit.toLocaleString('es-ES')}€` : '—'}</p>
                </div>
              </div>
              {selectedCard.budget && (
                <div className="w-full h-3 bg-white dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700">
                  <div
                    className="h-full rounded-full transition-all duration-1000"
                    style={{
                      width: `${selectedCard.limit > 0 ? Math.min((selectedCard.spent / selectedCard.limit) * 100, 100) : 0}%`,
                      background: `linear-gradient(90deg, ${selectedCard.color}40 0%, ${selectedCard.color} 100%)`,
                    }}
                  ></div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mb-4 flex-shrink-0">
              <History size={16} className="text-slate-400 dark:text-slate-600" />
              <h4 className="text-xs font-black text-slate-500 dark:text-slate-500 uppercase tracking-widest">Historial Reciente</h4>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-2">
              {detailTransactions.length > 0 ? detailTransactions.map(tx => (
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
                      {tx.type === 'income' ? '+' : '-'}{tx.amount.toLocaleString('es-ES')}€
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
              <button onClick={() => setSelectedCard(null)} className="w-full py-4 bg-slate-900 dark:bg-blue-600 text-white font-black rounded-2xl hover:bg-slate-800 dark:hover:bg-blue-700 transition-all active:scale-[0.98]">ENTENDIDO</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Importar de otro mes */}
      {showImportModal && (
        <div className="fixed inset-0 bg-slate-900/90 z-[60] flex items-center justify-center p-4" onClick={() => setShowImportModal(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-[3rem] w-full max-w-md p-8 md:p-10 shadow-2xl animate-in fade-in zoom-in duration-300 border border-slate-100 dark:border-slate-800 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-8">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-violet-50 dark:bg-violet-900/30 rounded-2xl flex items-center justify-center">
                  <Copy size={22} className="text-violet-500" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">Importar Presupuesto</h3>
                  <p className="text-xs text-slate-400 dark:text-slate-500 font-bold">Copia categorías de otro mes</p>
                </div>
              </div>
              <button onClick={() => setShowImportModal(false)} className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 transition-colors"><X size={24} /></button>
            </div>

            {periodBudgets.length > 0 && (
              <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-800 rounded-2xl">
                <p className="text-xs font-black text-amber-700 dark:text-amber-400">Se añadirán las categorías que falten en {formatPeriodLabel(currentDate)}. Lo que ya tengas en este mes se respeta.</p>
              </div>
            )}

            {availableImportPeriods.length > 0 ? (
              <div className="space-y-3">
                {availableImportPeriods.map(period => {
                  const count = budgets.filter(b => b.period === period).length;
                  return (
                    <button
                      key={period}
                      onClick={() => handleImport(period)}
                      className="w-full flex items-center justify-between p-5 bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl hover:border-violet-400 dark:hover:border-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/10 transition-all group active:scale-[0.98]"
                    >
                      <div className="flex items-center gap-3">
                        <Calendar size={18} className="text-slate-400 group-hover:text-violet-500 transition-colors" />
                        <div className="text-left">
                          <p className="font-black text-slate-800 dark:text-white text-sm transition-colors">{formatPeriodLabel(period)}</p>
                          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{count} categoría{count !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                      <ArrowRight size={16} className="text-slate-300 group-hover:text-violet-500 transition-colors" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/30 rounded-[2rem] border-2 border-dashed border-slate-200 dark:border-slate-700">
                <AlertCircle size={32} className="mx-auto text-slate-300 dark:text-slate-700 mb-3" />
                <p className="text-xs font-bold text-slate-400 dark:text-slate-600 uppercase tracking-widest">No hay otros meses con presupuesto</p>
              </div>
            )}
          </div>
        </div>
      )}

      {isFormOpen && (
        <div className="fixed inset-0 bg-slate-900/90 z-[60] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[3.5rem] w-full max-w-md p-10 md:p-14 shadow-2xl animate-in fade-in zoom-in duration-300 border border-slate-100 dark:border-slate-800 overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-10">
              <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                {activeTab === 'saving'
                  ? (formCard && formCard.budget ? 'Editar Objetivo' : 'Objetivo de Ahorro')
                  : (formCard ? 'Editar Límite' : 'Nueva Categoría')}
              </h3>
              <button onClick={closeForm} className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 transition-colors"><X size={24} /></button>
            </div>

            <form onSubmit={handleSave} className="space-y-8">
              {activeTab === 'saving' ? (
                <>
                  <div className="space-y-4">
                    <label className="block text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest pl-1">Hucha</label>
                    {formCard && formCard.budget && formCard.saving ? (
                      <p className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-black text-slate-800 dark:text-white">
                        {formCard.icon} {formCard.category}
                      </p>
                    ) : (
                      <div className="relative">
                        <select
                          value={savingChoice}
                          onChange={e => setSavingChoice(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-5 font-black text-slate-800 dark:text-white focus:border-amber-400 outline-none transition-all appearance-none cursor-pointer"
                        >
                          {savingsWithoutGoal.map(s => (
                            <option key={s.id} value={s.id} className="dark:bg-slate-900">{s.emoji || '💰'} {s.name}</option>
                          ))}
                          <option value={NEW_SAVING} className="dark:bg-slate-900">+ Nueva hucha</option>
                        </select>
                        <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-600 pointer-events-none" size={20} />
                      </div>
                    )}
                  </div>

                  {savingChoice === NEW_SAVING && (
                    <div className="space-y-4 p-5 rounded-3xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 animate-in slide-in-from-top-2">
                      <div className="grid grid-cols-[4.5rem_1fr] gap-3">
                        <input
                          type="text"
                          value={newSavingEmoji}
                          onChange={e => setNewSavingEmoji(e.target.value)}
                          className="bg-white dark:bg-slate-800 border-2 border-amber-100 dark:border-slate-700 rounded-2xl p-3 text-center text-xl outline-none text-slate-900 dark:text-white"
                          aria-label="Emoticono"
                        />
                        <input
                          type="text"
                          value={newSavingName}
                          onChange={e => setNewSavingName(e.target.value)}
                          placeholder="Nombre de la hucha"
                          className="bg-white dark:bg-slate-800 border-2 border-amber-100 dark:border-slate-700 rounded-2xl p-3 font-black outline-none text-slate-900 dark:text-white"
                        />
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        value={newSavingTarget}
                        onChange={e => setNewSavingTarget(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder="Meta total (opcional)"
                        className="w-full bg-white dark:bg-slate-800 border-2 border-amber-100 dark:border-slate-700 rounded-2xl p-3 font-bold outline-none text-slate-900 dark:text-white"
                      />
                    </div>
                  )}
                </>
              ) : (
                <>
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
                          setFormError(null);
                          const isAnother = e.target.value === 'Otra';
                          setIsCustomMode(isAnother);
                          if (!isAnother) {
                            const defaultList = activeTab === 'expense' ? CATEGORIES : INCOME_CATEGORIES;
                            const match = defaultList.find(c => c.name === e.target.value);
                            if (match) {
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
                      <input type="text" placeholder="Nombre de categoría..." className="w-full bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-100 dark:border-blue-900 rounded-2xl p-5 font-black text-blue-900 dark:text-blue-300 outline-none animate-in slide-in-from-top-2" value={customCategory} onChange={e => { setCustomCategory(e.target.value); setFormError(null); }} required />
                    )}
                  </div>
                </>
              )}

              <div className="space-y-4">
                <label className="block text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest pl-1">
                  {activeTab === 'saving' ? 'Aportación Mensual (€)' : 'Importe Mensual (€)'}
                </label>
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

              {formError && (
                <p className="text-xs font-black text-rose-600 dark:text-rose-400 text-center">{formError}</p>
              )}

              <div className="flex gap-4 pt-4">
                <button type="button" onClick={closeForm} className="flex-1 py-5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400 font-black rounded-2xl transition-colors">CANCELAR</button>
                <button type="submit" className="flex-1 py-5 bg-blue-600 text-white font-black rounded-2xl shadow-xl shadow-blue-100 dark:shadow-none flex items-center justify-center gap-2 transition-all active:scale-[0.98]">{formCard ? <Edit2 size={18}/> : <Plus size={18}/>}{formCard && formCard.budget ? 'GUARDAR' : 'CREAR'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Undo Toast */}
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

export default BudgetManager;
