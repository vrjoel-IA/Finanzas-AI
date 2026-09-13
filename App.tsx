
import React, { useState, useEffect, useLayoutEffect, useMemo, createContext, useContext, useRef, useCallback } from 'react';
import { HashRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, Wallet, PiggyBank, Receipt, BarChart3, 
  MessageSquare, Menu, X, Plus, Camera, CalendarDays, 
  CalendarRange, Sun, Moon, LineChart as LineChartIcon, 
  LogOut, Loader2, Sparkles, CloudCheck, CloudUpload, RefreshCw,
  ChevronLeft, ChevronRight, AlertTriangle, CloudOff,
  RefreshCcw
} from 'lucide-react';
import { FinanceState, Account, Saving, Refund, Transaction, Budget, AIChallenge, ExtraSaving, ChatMessage } from './types';
import { INITIAL_DATA } from './constants';
import { supabase } from './services/supabase';
import { syncRefundsWithTransactions as syncRefunds } from './services/refunds';
import { buildPeriodIndex, aggregatePeriod } from './services/periodIndex';
import type { PeriodIndex, PeriodAggregate } from './services/periodIndex';
import { buildIndexWeights, hasSharedEntities, ownershipWeight } from './services/ownership';
import { resolveEffectiveBudgets, materializeBudgets } from './services/budgetPlan';
import type { EffectiveBudget } from './services/budgetPlan';
import { isMonthKey, normalizePeriodForView } from './services/periods';

// Componentes de vistas
import Dashboard from './components/Dashboard';
import Accounts from './components/Accounts';
import Savings from './components/Savings';
import Refunds from './components/Refunds';
import Transactions from './components/Transactions';
import BudgetManager from './components/Budget';
import AIAdvisor from './components/AIAdvisor';
import WealthProjections from './components/WealthProjections';
import Login from './components/Login';

// Helper para timeouts de red (Aumentado default a 10s)
const withTimeout = <T,>(promise: PromiseLike<T>, ms: number = 10000): Promise<T> => {
    return Promise.race([
        Promise.resolve(promise),
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('La conexión está tardando demasiado')), ms))
    ]);
};

// Helper seguro para localStorage
const safeSetItem = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn("App: Error escribiendo en LocalStorage (Quota/Privacidad):", e);
  }
};

const safeGetItem = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn("App: Error leyendo LocalStorage:", e);
    return null;
  }
};

interface FinanceContextType extends FinanceState {
  getAccountHistoricalBalance: (accountId: string, dateStr: string) => number;
  getSavingHistoricalBalance: (savingId: string, dateStr: string) => number;
  getNetWorthHistorical: (dateStr: string) => number; 
  addTransaction: (t: Omit<Transaction, 'id'>, myPart?: number) => void;
  updateTransaction: (t: Transaction) => void;
  deleteTransaction: (id: string) => void;
  addAccount: (a: Omit<Account, 'id' | 'currentBalance'>) => void;
  updateAccount: (a: Account) => void;
  deleteAccount: (id: string) => void;
  addSaving: (s: Omit<Saving, 'id'>) => void;
  updateSaving: (s: Saving) => void;
  deleteSaving: (id: string) => void;
  addRefund: (r: Omit<Refund, 'id'>) => void;
  updateRefund: (r: Refund) => void;
  deleteRefund: (id: string) => void;
  mergeRefunds: (id1: string, id2: string) => void;
  addBudget: (b: Omit<Budget, 'id' | 'spent' | 'icon' | 'type'> & { type?: 'income' | 'expense'; icon?: string }) => void;
  updateBudget: (b: Budget) => void;
  deleteBudget: (id: string) => void;
  changePeriod: (offset: number) => void;
  setPeriod: (date: string) => void;
  setViewMode: (mode: 'month' | 'year') => void;
  updateLayout: (newLayout: string[]) => void;
  setChallenges: (challenges: AIChallenge[]) => void;
  toggleTheme: () => void;
  updateChatHistory: (history: ChatMessage[]) => void;
  importBudgetFromMonth: (sourceDate: string, targetDate: string) => void;
  getEffectiveBudgets: (targetDate: string) => EffectiveBudget[];
  /** Convierte presupuestos heredados en propios del mes. Unica escritura del sistema de herencia. */
  materializeBudgetsForPeriod: (targetDate: string, categories: string[] | 'all') => void;

  // Capa de analisis: un unico recorrido sobre las transacciones, compartido por
  // comparativas, anillo de categorias, graficos y proyeccion realista. Es solo
  // lectura: no escribe nada ni sustituye a los calculos ya existentes.
  periodIndex: PeriodIndex;
  getPeriodAggregate: (key: string) => PeriodAggregate;

  // Cuenta conjunta. El libro contable (saldos, lista de movimientos) siempre va
  // integro; `viewIndex` es el que respeta el selector de importes.
  viewIndex: PeriodIndex;
  amountView: 'full' | 'mine';
  setAmountView: (view: 'full' | 'mine') => void;
  hasSharedAccounts: boolean;
  getOwnedAccountBalance: (accountId: string, dateStr: string) => number;
  
  // Wealth Projection Methods
  addExtraSaving: (e: Omit<ExtraSaving, 'id'>) => void;
  deleteExtraSaving: (id: string) => void;
  updateManualContribution: (savingId: string, amount: number) => void;

  isGuest: boolean;
  isSyncing: boolean;
  syncError: boolean;
  loginAsGuest: () => void;
  retrySync: () => void;
  manualRefresh: () => Promise<void>;
  saveData: () => Promise<void>;
  forceResync: () => Promise<void>;

  // Undo system
  startUndoBatch: () => void;
  commitUndoBatch: (label: string) => void;
  cancelUndoBatch: () => void;
  undoLastAdd: () => {ids: string[], label: string} | null;
  undoCount: number;

  // Budget undo system
  undoBudgetChange: () => {label: string} | null;
  budgetUndoCount: number;
  getPeriodsWithBudgets: () => string[];
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined);
export const useFinance = () => {
  const context = useContext(FinanceContext);
  if (!context) throw new Error("useFinance must be used within FinanceProvider");
  return context;
};

const App: React.FC = () => {
  console.log("App component rendering");
  const [session, setSession] = useState<any>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [state, setState] = useState<FinanceState>(INITIAL_DATA as any);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // Selector de importes de las cuentas compartidas. Vive en localStorage y NO en
  // FinanceState: es una preferencia de este dispositivo, y meterla en el estado
  // haria que cada vez que se cambia se subiera el documento entero a la nube.
  const [amountView, setAmountViewState] = useState<'full' | 'mine'>(
    () => (safeGetItem('finanzas_pro_amount_view') === 'full' ? 'full' : 'mine'),
  );
  const setAmountView = useCallback((view: 'full' | 'mine') => {
    setAmountViewState(view);
    safeSetItem('finanzas_pro_amount_view', view);
  }, []);
  const [isAppInitializing, setIsAppInitializing] = useState(true); 
  const [isSyncing, setIsSyncing] = useState(false); 
  const [syncError, setSyncError] = useState(false); 
  const [initializationTimeout, setInitializationTimeout] = useState(false); 
  const [dataLoadedFromCloud, setDataLoadedFromCloud] = useState(false);

  // Ref para evitar bucles de guardado al cargar datos de la nube
  const ignoreNextUpdate = useRef(false);
  // Ref para el estado actual (para usar en beforeunload)
  const stateRef = useRef(state);
  // Ref para evitar concurrencia en fetchUserData
  const syncInProgressRef = useRef(false);
  const initAppRunningRef = useRef(false);
  // Ref para throttle de visibilidad
  const lastSyncTimeRef = useRef(0);

  // Sistema de Undo
  const undoStackRef = useRef<{ids: string[], label: string}[]>([]);
  const currentBatchRef = useRef<string[]>([]);
  const batchModeRef = useRef(false);
  const [undoCount, setUndoCount] = useState(0);

  // Budget Undo System
  const budgetUndoStackRef = useRef<{budgets: Budget[], label: string, period?: string}[]>([]);
  // Ultimo mes visitado, para volver a el al salir de la vista anual. Es solo de
  // sesion: no se persiste ni viaja a la nube.
  const lastMonthKeyRef = useRef<string | undefined>(undefined);
  const [budgetUndoCount, setBudgetUndoCount] = useState(0);

  // CLAVES DE ALMACENAMIENTO LOCAL
  const getBackupKey = (userId: string) => `finanzas_pro_backup_${userId}`;
  const getTimestampKey = (userId: string) => `finanzas_pro_backup_${userId}_timestamp`;
  const getDirtyKey = (userId: string) => `finanzas_pro_dirty_${userId}`;

  // Función auxiliar robusta para sincronizar deudas con transacciones
  // Implementacion en services/refunds.ts: es pura y esta cubierta por tests.
  const syncRefundsWithTransactions = useCallback(
    (txs: Transaction[], existingRefunds: Refund[]) => syncRefunds(txs, existingRefunds),
    [],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (state.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [state.theme]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (session?.user?.id && !isGuest && !ignoreNextUpdate.current) {
        try {
            const key = getBackupKey(session.user.id);
            const tsKey = getTimestampKey(session.user.id);
            const dirtyKey = getDirtyKey(session.user.id);
            // Guardar el estado actual como backup
            localStorage.setItem(key, JSON.stringify(stateRef.current));
            // IMPORTANTE: Mantener el timestamp existente para no inflar la fecha.
            // Solo poner timestamp nuevo si no existe uno previo.
            const existingTs = localStorage.getItem(tsKey);
            if (!existingTs) {
              localStorage.setItem(tsKey, Date.now().toString());
            }
            localStorage.setItem(dirtyKey, 'true');
        } catch (e) {}
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [session, isGuest]);

  const fetchUserData = useCallback(async (userId: string) => {
    if (syncInProgressRef.current) return;
    syncInProgressRef.current = true;
    setIsSyncing(true); 
    setSyncError(false); 
    
    const localBackup = safeGetItem(getBackupKey(userId));
    const localTimestampStr = safeGetItem(getTimestampKey(userId));
    let localState: FinanceState | null = null;
    let localTime = 0;

    if (localBackup) {
        try {
            localState = JSON.parse(localBackup);
            localTime = localTimestampStr ? parseInt(localTimestampStr) : 0;
            if (localState) {
                ignoreNextUpdate.current = true;
                setState(prev => ({ ...INITIAL_DATA, ...localState }));
                setDataLoadedFromCloud(true); 
                setTimeout(() => { ignoreNextUpdate.current = false; }, 500);
            }
        } catch (e) {}
    }

    try {
      const { data, error } = await withTimeout<any>(
        supabase
          .from('profiles')
          .select('state, updated_at')
          .eq('id', userId)
          .maybeSingle(), 
        15000 
      );

      if (error) throw error;
      const cloudTime = data?.updated_at ? new Date(data.updated_at).getTime() : 0;
      const isDirty = safeGetItem(getDirtyKey(userId)) === 'true';

      console.log(`[Sync] Local: ${localTime ? new Date(localTime).toISOString() : 'none'}, Cloud: ${cloudTime ? new Date(cloudTime).toISOString() : 'none'}, isDirty: ${isDirty}`);

      // REGLA: Solo subir datos locales si el timestamp local es >= al de la nube.
      // Esto evita machacar datos más nuevos del móvil/otro dispositivo.
      const localIsNewerOrEqual = localTime >= cloudTime;
      const localIsSignificantlyNewer = localTime > cloudTime + 5000;

      if (localState && localIsNewerOrEqual && (isDirty || localIsSignificantlyNewer)) {
        console.log('[Sync] → Subiendo datos locales a la nube (local más reciente)');
        await withTimeout<any>(
            supabase.from('profiles').upsert({
                id: userId,
                state: localState,
                updated_at: new Date(localTime || Date.now()).toISOString()
            }), 
            15000
          );
          safeSetItem(getDirtyKey(userId), 'false');
      } else if (data && data.state && cloudTime > localTime) {
        console.log('[Sync] → Descargando datos de la nube (nube más reciente)');
        const mergedState = { ...INITIAL_DATA, ...data.state };
          ignoreNextUpdate.current = true;
          setState(mergedState as FinanceState);
          safeSetItem(getBackupKey(userId), JSON.stringify(mergedState));
          safeSetItem(getTimestampKey(userId), cloudTime.toString());
          safeSetItem(getDirtyKey(userId), 'false');
          setTimeout(() => { ignoreNextUpdate.current = false; }, 500);
      } else {
        console.log('[Sync] → Sin cambios (datos sincronizados)');
        // Limpiar dirty flag si no hay nada que subir
        if (isDirty) safeSetItem(getDirtyKey(userId), 'false');
      }
      setDataLoadedFromCloud(true);
    } catch (err) {
      console.error('[Sync] Error:', err);
      setSyncError(true); 
    } finally {
      setIsSyncing(false);
      syncInProgressRef.current = false;
    }
  }, [setIsSyncing, setSyncError, setState, setDataLoadedFromCloud]);

  const manualRefresh = useCallback(async () => {
    if (!session || isGuest) return;
    await fetchUserData(session.user.id);
  }, [session, isGuest, fetchUserData]);

  useEffect(() => {
    const handleReSync = async () => {
      const now = Date.now();
      if (document.visibilityState === 'visible' && session?.user?.id && !isGuest && !isSyncing && !syncInProgressRef.current) {
        if (now - lastSyncTimeRef.current < 30000) return;
        lastSyncTimeRef.current = now;
        setTimeout(() => fetchUserData(session.user.id), 500);
      }
    };
    document.addEventListener('visibilitychange', handleReSync);
    return () => document.removeEventListener('visibilitychange', handleReSync);
  }, [session, isGuest, isSyncing, fetchUserData]);

  const loginAsGuest = useCallback(() => {
    safeSetItem('finanzas_pro_guest', 'true');
    setIsGuest(true);
    const saved = safeGetItem('finanzas_pro_local_state');
    if (saved) setState({ ...INITIAL_DATA, ...JSON.parse(saved) } as FinanceState);
    else setState(INITIAL_DATA as any);
    setIsAppInitializing(false); 
    setSyncError(false); 
    setInitializationTimeout(false); 
  }, [setIsGuest, setState, setIsAppInitializing, setSyncError, setInitializationTimeout]);

  const initApp = useCallback(async () => {
    if (initAppRunningRef.current) return;
    initAppRunningRef.current = true;
    console.log("initApp called");
    setIsAppInitializing(true); 
    setSyncError(false); 
    setInitializationTimeout(false); 

    let timeoutId = window.setTimeout(() => {
        setInitializationTimeout(true); 
        setIsAppInitializing(false);
    }, 5000); 

    console.log("initApp: llamando a supabase.auth.getSession()");
    try {
      const { data: { session: currentSession }, error: sessionError } = await withTimeout(supabase.auth.getSession(), 5000);
      console.log("initApp: supabase.auth.getSession() completado", { currentSession, sessionError });
      if (sessionError) throw sessionError;
      if (currentSession) {
        setSession(currentSession);
        setIsGuest(false);
        await fetchUserData(currentSession.user.id); 
      } else {
        const guestFlag = safeGetItem('finanzas_pro_guest') === 'true';
        if (guestFlag) {
          setIsGuest(true);
          const savedState = safeGetItem('finanzas_pro_local_state');
          if (savedState) setState({ ...INITIAL_DATA, ...JSON.parse(savedState) } as FinanceState);
          setDataLoadedFromCloud(false); 
        } else {
          setSession(null); 
          setIsGuest(false);
          setDataLoadedFromCloud(false);
          setState(INITIAL_DATA as any); 
        }
      }
    } catch (err) {
      setSyncError(true); 
      const guestFlag = safeGetItem('finanzas_pro_guest') === 'true';
      if (guestFlag) {
           setIsGuest(true);
           const savedState = safeGetItem('finanzas_pro_local_state');
           if (savedState) setState({ ...INITIAL_DATA, ...JSON.parse(savedState) } as FinanceState);
      }
    } finally {
      window.clearTimeout(timeoutId); 
      console.log("initApp: llamando a setIsAppInitializing(false)");
      setIsAppInitializing(false); 
      initAppRunningRef.current = false;
    }
  }, [fetchUserData, setSession, setIsGuest, setState, setIsAppInitializing, setSyncError, setInitializationTimeout, setDataLoadedFromCloud]);

  const saveData = useCallback(async () => {
    if (!session || isGuest) return;
    setIsSyncing(true);
    setSyncError(false);
    const now = new Date();
    safeSetItem(getBackupKey(session.user.id), JSON.stringify(state));
    safeSetItem(getTimestampKey(session.user.id), now.getTime().toString());
    try {
      const { error } = await withTimeout<any>(
        supabase.from('profiles').upsert({ id: session.user.id, state, updated_at: now.toISOString() }),
        10000 
      );
      if (error) {
        console.error("Supabase Save Error:", error);
        throw error;
      }
      safeSetItem(getDirtyKey(session.user.id), 'false');
    } catch (err) {
      console.error("saveData general error:", err);
      setSyncError(true);
    } finally {
      setIsSyncing(false); 
    }
  }, [session, isGuest, state, setIsSyncing, setSyncError]);

  const forceResync = useCallback(async () => {
    if (!session || isGuest) return;
    setIsSyncing(true);
    // Limpiar flags locales para forzar descarga desde la nube
    safeSetItem(getDirtyKey(session.user.id), 'false');
    safeSetItem(getTimestampKey(session.user.id), '0');
    try {
        await fetchUserData(session.user.id);
    } catch(e) {
        console.error("forceResync error:", e);
        setSyncError(true);
    } finally {
        setIsSyncing(false);
    }
  }, [session, isGuest, fetchUserData]);

  const retrySync = useCallback(async () => await saveData(), [saveData]);

  useLayoutEffect(() => {
    console.log("App: useLayoutEffect mount, calling initApp");
    initApp();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (newSession && newSession.user.id !== session?.user?.id) {
            setSession(newSession);
            setIsGuest(false);
            if (!syncInProgressRef.current) await fetchUserData(newSession.user.id);
          }
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setIsGuest(false);
        setState(INITIAL_DATA as any); 
        setDataLoadedFromCloud(false);
      }
    });
    return () => subscription.unsubscribe();
  }, [fetchUserData, initApp, setSession, setIsGuest, setState, setDataLoadedFromCloud]);

  useEffect(() => {
    let debounceTimer: number;
    if (ignoreNextUpdate.current) return;
    if (!isAppInitializing) {
      debounceTimer = window.setTimeout(async () => {
        const now = new Date();
        if (session) {
           safeSetItem(getBackupKey(session.user.id), JSON.stringify(state));
           safeSetItem(getTimestampKey(session.user.id), now.getTime().toString());
           safeSetItem(getDirtyKey(session.user.id), 'true');
        } else if (isGuest) {
           safeSetItem('finanzas_pro_local_state', JSON.stringify(state));
        }
        if (session && dataLoadedFromCloud && !isGuest) {
            setIsSyncing(true);
            try {
              const { error } = await withTimeout<any>(
                 supabase.from('profiles').upsert({ id: session.user.id, state, updated_at: now.toISOString() }),
                20000 
              );
              if (error) throw error;
              safeSetItem(getDirtyKey(session.user.id), 'false');
              setSyncError(false); 
            } catch (err) {
              setSyncError(true); 
            } finally {
              setIsSyncing(false); 
            }
        }
      }, 2000); 
    }
    return () => window.clearTimeout(debounceTimer);
  }, [state, session, isGuest, isAppInitializing, dataLoadedFromCloud, setIsSyncing, setSyncError]);

  const logout = () => {
    localStorage.removeItem('finanzas_pro_guest');
    setIsGuest(false);
    setSession(null);
    setDataLoadedFromCloud(false);
    supabase.auth.signOut();
  };

  const getAccountHistoricalBalance = useCallback((accountId: string, dateStr: string) => {
    const account = state.accounts.find(a => a.id === accountId);
    if (!account) return 0;
    let cutoffDate = dateStr;
    if (dateStr.length === 4) cutoffDate = `${dateStr}-12-31`;
    else if (dateStr.length === 7) { 
      const [y, m] = dateStr.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      cutoffDate = `${dateStr}-${lastDay}`;
    }
    let balance = account.initialBalance;
    state.transactions.filter(t => t.accountId === accountId && t.date <= cutoffDate).forEach(t => {
      balance += (t.type === 'income' ? t.amount : -t.amount);
    });
    return balance;
  }, [state.accounts, state.transactions]);

  const getSavingHistoricalBalance = useCallback((savingId: string, dateStr: string) => {
    const saving = state.savings.find(s => s.id === savingId);
    if (!saving) return 0;
    let cutoffDate = dateStr;
    if (dateStr.length === 4) cutoffDate = `${dateStr}-12-31`;
    else if (dateStr.length === 7) {
      const [y, m] = dateStr.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      cutoffDate = `${dateStr}-${lastDay}`;
    }
    let balance = saving.currentAmount;
    state.transactions.filter(t => t.savingId === savingId && t.date <= cutoffDate).forEach(t => {
      balance += (t.type === 'expense' ? t.amount : -t.amount);
    });
    return balance;
  }, [state.savings, state.transactions]);

  const getNetWorthHistorical = useCallback((dateStr: string) => {
    const accountsTotal = state.accounts.reduce((sum, acc) => sum + getAccountHistoricalBalance(acc.id, dateStr), 0);
    const savingsTotal = state.savings.reduce((sum, sav) => sum + getSavingHistoricalBalance(sav.id, dateStr), 0);
    return accountsTotal + savingsTotal;
  }, [state.accounts, state.savings, getAccountHistoricalBalance, getSavingHistoricalBalance]);

  // Indice de analisis. Depende solo de las transacciones, asi que se reconstruye
  // unicamente cuando cambia el historial, no al cambiar de mes ni de tema.
  // Los calculos que ya existian (saldos historicos, metricas del dashboard) NO
  // pasan por aqui: siguen exactamente igual que antes.
  const periodIndex = useMemo(() => buildPeriodIndex(state.transactions), [state.transactions]);

  // Titularidad parcial. El indice ponderado solo se construye si de verdad hay
  // algo compartido; en el caso normal se reutiliza el mismo objeto.
  const hasSharedAccounts = useMemo(
    () => hasSharedEntities(state.accounts, state.savings),
    [state.accounts, state.savings],
  );
  const ownedIndex = useMemo(() => {
    if (!hasSharedAccounts) return periodIndex;
    return buildPeriodIndex(state.transactions, buildIndexWeights(state.accounts, state.savings));
  }, [hasSharedAccounts, periodIndex, state.transactions, state.accounts, state.savings]);
  const viewIndex = amountView === 'mine' ? ownedIndex : periodIndex;

  const getOwnedAccountBalance = useCallback((accountId: string, dateStr: string) => {
    const account = state.accounts.find(a => a.id === accountId);
    return getAccountHistoricalBalance(accountId, dateStr) * ownershipWeight(account?.ownershipPercent);
  }, [state.accounts, getAccountHistoricalBalance]);

  const getPeriodAggregate = useCallback(
    (key: string) => aggregatePeriod(periodIndex, key),
    [periodIndex],
  );

  const contextValue = useMemo<FinanceContextType>(() => ({
    ...state,
    extraSavings: state.extraSavings || [],
    manualContributions: state.manualContributions || {},
    getAccountHistoricalBalance,
    getSavingHistoricalBalance,
    getNetWorthHistorical, 
    periodIndex,
    getPeriodAggregate,
    viewIndex,
    amountView,
    setAmountView,
    hasSharedAccounts,
    getOwnedAccountBalance,
    isGuest,
    isSyncing,
    syncError,
    loginAsGuest,
    retrySync,
    manualRefresh,
    saveData,
    forceResync,
    
    importBudgetFromMonth: (sourceDate, targetDate) => setState(prev => {
      // Guardar snapshot para undo antes de importar
      const currentPeriodBudgets = prev.budgets.filter(bg => bg.period === targetDate);
      budgetUndoStackRef.current.push({ budgets: currentPeriodBudgets, label: `Importar de ${sourceDate}`, period: targetDate });
      if (budgetUndoStackRef.current.length > 20) budgetUndoStackRef.current.shift();
      setBudgetUndoCount(budgetUndoStackRef.current.length);

      // Fusion por categoria en vez de borrado: antes esto eliminaba en silencio
      // todo lo que ya hubiera en el mes destino.
      const sourceBudgets = prev.budgets.filter(b => b.period === sourceDate && isMonthKey(b.period));
      const existing = new Set(
        prev.budgets.filter(b => b.period === targetDate).map(b => b.category + '|' + (b.type || 'expense')),
      );
      const newBudgets = sourceBudgets
        .filter(b => !existing.has(b.category + '|' + (b.type || 'expense')))
        .map(b => ({
          ...b,
          id: 'budget_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          period: targetDate,
          spent: 0
        }));
      return { ...prev, budgets: [...prev.budgets, ...newBudgets] };
    }),
    // Los presupuestos aplicables a un mes se CALCULAN, no se copian. Antes la
    // unica herencia vivia en un useEffect de la pantalla de Presupuesto, que
    // escribia datos con solo navegar: por eso el dashboard mostraba un mes vacio
    // hasta que entrabas ahi, y entonces aparecian de golpe.
    getEffectiveBudgets: (targetDate) => resolveEffectiveBudgets(state.budgets, targetDate, periodIndex),

    materializeBudgetsForPeriod: (targetDate, categories) => setState(prev => {
      if (!isMonthKey(targetDate)) return prev;
      const next = materializeBudgets(
        prev.budgets,
        targetDate,
        categories,
        () => 'budget_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        periodIndex,
      );
      if (next === prev.budgets) return prev;
      budgetUndoStackRef.current.push({ budgets: prev.budgets.filter(bg => bg.period === targetDate), label: 'Personalizar mes', period: targetDate });
      if (budgetUndoStackRef.current.length > 20) budgetUndoStackRef.current.shift();
      setBudgetUndoCount(budgetUndoStackRef.current.length);
      return { ...prev, budgets: next };
    }),

    addTransaction: (t, myPart) => {
      const id = 'tx_' + Math.random().toString(36).substr(2, 9);
      const finalTx = { ...t, id } as Transaction;
      
      // Undo tracking
      if (batchModeRef.current) {
        currentBatchRef.current.push(id);
      } else {
        undoStackRef.current.push({ ids: [id], label: t.description || 'Transacción' });
        // Limitar el stack a 30 acciones
        if (undoStackRef.current.length > 30) undoStackRef.current.shift();
        setUndoCount(undoStackRef.current.length);
      }

      setState(prev => {
        let updatedRefunds = [...prev.refunds];
        if (t.type === 'expense' && t.isRefund) {
          const refundId = 'ref_' + Date.now();
          const partToPay = myPart !== undefined ? myPart : t.amount / 2;
          updatedRefunds.push({ 
            id: refundId, name: t.description, totalAmount: t.amount, 
            paidByMe: partToPay, pendingAmount: t.amount - partToPay, 
            status: 'open', notes: 'Auto', date: t.date, 
            category: t.category, originTransactionId: id 
          });
          finalTx.refundId = refundId;
        }
        
        const nextTransactions = [finalTx, ...prev.transactions];
        const syncedRefunds = syncRefundsWithTransactions(nextTransactions, updatedRefunds);
        return { ...prev, transactions: nextTransactions, refunds: syncedRefunds };
      });
    },
    updateTransaction: (updatedTx) => {
      setState(prev => {
        const newTransactions = prev.transactions.map(t => t.id === updatedTx.id ? updatedTx : t);
        const syncedRefunds = syncRefundsWithTransactions(newTransactions, prev.refunds);
        return { ...prev, transactions: newTransactions, refunds: syncedRefunds };
      });
    },
    deleteTransaction: (id) => {
      setState(prev => {
        const txToDelete = prev.transactions.find(t => t.id === id);
        if (!txToDelete) return prev;
        let newTransactions = prev.transactions.filter(tx => tx.id !== id);
        let newRefunds = prev.refunds;
        if (txToDelete.type === 'expense' && txToDelete.isRefund && txToDelete.refundId) {
          newRefunds = newRefunds.filter(r => r.id !== txToDelete.refundId);
        } else {
          newRefunds = syncRefundsWithTransactions(newTransactions, newRefunds);
        }
        return { ...prev, transactions: newTransactions, refunds: newRefunds };
      });
    },
    addAccount: (a) => setState(prev => ({ ...prev, accounts: [...prev.accounts, { ...a, id: 'acc_' + Date.now(), currentBalance: a.initialBalance } as Account] })),
    updateAccount: (a) => setState(prev => ({ ...prev, accounts: prev.accounts.map(acc => acc.id === a.id ? a : acc) })),
    deleteAccount: (id) => setState(prev => ({ ...prev, accounts: prev.accounts.filter(a => a.id !== id) })),
    addSaving: (s) => setState(prev => ({ ...prev, savings: [...prev.savings, { ...s, id: 'sav_' + Date.now() } as Saving] })),
    updateSaving: (s) => setState(prev => ({ ...prev, savings: prev.savings.map(sv => sv.id === s.id ? s : sv) })),
    deleteSaving: (id) => setState(prev => ({ ...prev, savings: prev.savings.filter(s => s.id !== id) })),
    addRefund: (r) => setState(prev => ({ ...prev, refunds: [...prev.refunds, { ...r, id: 'ref_' + Date.now() } as Refund] })),
    updateRefund: (r) => setState(prev => {
      const newRefunds = prev.refunds.map(rf => rf.id === r.id ? r : rf);
      const syncedRefunds = syncRefundsWithTransactions(prev.transactions, newRefunds);
      return { ...prev, refunds: syncedRefunds };
    }),
    deleteRefund: (id) => setState(prev => ({ ...prev, refunds: prev.refunds.filter(r => r.id !== id) })),
    mergeRefunds: (id1, id2) => {
      const r1 = state.refunds.find(r => r.id === id1);
      const r2 = state.refunds.find(r => r.id === id2);
      if (!r1 || !r2) return;
      const merged: Refund = { id: 'ref_' + Date.now(), name: `${r1.name} + ${r2.name}`, totalAmount: r1.totalAmount + r2.totalAmount, paidByMe: r1.paidByMe + r2.paidByMe, pendingAmount: r1.pendingAmount + r2.pendingAmount, status: (r1.status === 'open' || r2.status === 'open') ? 'open' : 'closed', notes: `Fusionado: ${r1.notes} | ${r2.notes}`, date: new Date().toISOString(), category: r1.category };
      setState(prev => ({ ...prev, refunds: [...prev.refunds.filter(r => r.id !== id1 && r.id !== id2), merged] }));
    },
    addBudget: (b) => setState(prev => {
      const period = b.period || prev.currentDate;
      // En vista anual currentDate es 'YYYY'. Un presupuesto con ese periodo no
      // aparece en ningun mes: mejor no crearlo que crearlo invisible.
      if (!isMonthKey(period)) {
        console.warn('[Presupuestos] Selecciona un mes concreto para crear un presupuesto.');
        return prev;
      }
      // Guardar snapshot para undo
      const currentPeriodBudgets = prev.budgets.filter(bg => bg.period === period);
      budgetUndoStackRef.current.push({ budgets: currentPeriodBudgets, label: `Añadir ${b.category}`, period });
      if (budgetUndoStackRef.current.length > 20) budgetUndoStackRef.current.shift();
      setBudgetUndoCount(budgetUndoStackRef.current.length);

      const existingIndex = prev.budgets.findIndex(bg => bg.category === b.category && bg.period === period);
      if (existingIndex >= 0) {
        const newBudgets = [...prev.budgets];
        newBudgets[existingIndex] = { ...newBudgets[existingIndex], ...b, period };
        return { ...prev, budgets: newBudgets };
      }
      return { ...prev, budgets: [...prev.budgets, { ...b, id: 'budget_' + Date.now(), spent: 0, period } as Budget] };
    }),
    updateBudget: (b) => setState(prev => {
      // Se respeta el periodo que ya tuviera. Antes se le estampaba el mes actual,
      // asi que editar un presupuesto sin periodo lo secuestraba para ese mes y
      // desaparecia de todos los demas.
      const period = b.period;
      const currentPeriodBudgets = prev.budgets.filter(bg => bg.period === period);
      budgetUndoStackRef.current.push({ budgets: currentPeriodBudgets, label: `Editar ${b.category}`, period });
      if (budgetUndoStackRef.current.length > 20) budgetUndoStackRef.current.shift();
      setBudgetUndoCount(budgetUndoStackRef.current.length);

      return { ...prev, budgets: prev.budgets.map(bg => bg.id === b.id ? { ...b, period } : bg) };
    }),
    deleteBudget: (id) => setState(prev => {
      const target = prev.budgets.find(b => b.id === id);
      if (target) {
        const period = target.period;
        const currentPeriodBudgets = prev.budgets.filter(bg => bg.period === period);
        budgetUndoStackRef.current.push({ budgets: currentPeriodBudgets, label: `Eliminar ${target.category}`, period });
        if (budgetUndoStackRef.current.length > 20) budgetUndoStackRef.current.shift();
        setBudgetUndoCount(budgetUndoStackRef.current.length);
      }
      return { ...prev, budgets: prev.budgets.filter(b => b.id !== id) };
    }),
    addExtraSaving: (e) => setState(prev => ({ ...prev, extraSavings: [...(prev.extraSavings || []), { ...e, id: 'extra_' + Date.now() } as ExtraSaving] })),
    deleteExtraSaving: (id) => setState(prev => ({ ...prev, extraSavings: (prev.extraSavings || []).filter(e => e.id !== id) })),
    updateManualContribution: (savingId, amount) => setState(prev => ({ ...prev, manualContributions: { ...(prev.manualContributions || {}), [savingId]: amount } })),
    changePeriod: (offset) => {
      const [year, month] = state.currentDate.split('-').map(Number);
      const newDate = state.viewMode === 'year' ? new Date(year + offset, 0, 1) : new Date(year, (month || 1) - 1 + offset, 1); 
      const newDateStr = state.viewMode === 'year' ? newDate.getFullYear().toString() : `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}`;
      setState(prev => ({ ...prev, currentDate: newDateStr }));
    },
    setPeriod: (dateStr) => setState(prev => ({ ...prev, currentDate: dateStr })),
    setViewMode: (mode) => setState(prev => {
      // Sin normalizar, pasar a anual dejaba currentDate en 'YYYY-MM' (la cabecera
      // imprimia "Año 2026-10") y volver a mes lo dejaba en 'YYYY', con lo que la
      // flecha de periodo saltaba a enero.
      const currentDate = normalizePeriodForView(prev.currentDate, mode, lastMonthKeyRef.current);
      if (isMonthKey(prev.currentDate)) lastMonthKeyRef.current = prev.currentDate;
      return { ...prev, viewMode: mode, currentDate };
    }),
    updateLayout: (newLayout) => setState(prev => ({ ...prev, dashboardLayout: newLayout })),
    setChallenges: (challenges) => setState(prev => ({ ...prev, challenges })),
    toggleTheme: () => setState(prev => ({ ...prev, theme: prev.theme === 'light' ? 'dark' : 'light' })),
    updateChatHistory: (history) => setState(prev => ({ ...prev, chatHistory: history, chatLastDate: new Date().toISOString().split('T')[0] })),

    // Undo system
    startUndoBatch: () => {
      batchModeRef.current = true;
      currentBatchRef.current = [];
    },
    commitUndoBatch: (label: string) => {
      batchModeRef.current = false;
      if (currentBatchRef.current.length > 0) {
        undoStackRef.current.push({ ids: [...currentBatchRef.current], label });
        if (undoStackRef.current.length > 30) undoStackRef.current.shift();
        currentBatchRef.current = [];
        setUndoCount(undoStackRef.current.length);
      }
    },
    cancelUndoBatch: () => {
      batchModeRef.current = false;
      currentBatchRef.current = [];
    },
    undoLastAdd: () => {
      const lastGroup = undoStackRef.current.pop();
      setUndoCount(undoStackRef.current.length);
      if (!lastGroup) return null;
      
      setState(prev => {
        // Encontrar las transacciones a eliminar
        const txsToRemove = prev.transactions.filter(t => lastGroup.ids.includes(t.id));
        // Recopilar IDs de reembolsos asociados
        const refundIdsToRemove = txsToRemove
          .filter(t => t.type === 'expense' && t.isRefund && t.refundId)
          .map(t => t.refundId!);
        
        let newTransactions = prev.transactions.filter(t => !lastGroup.ids.includes(t.id));
        let newRefunds = prev.refunds.filter(r => !refundIdsToRemove.includes(r.id));
        newRefunds = syncRefundsWithTransactions(newTransactions, newRefunds);
        
        return { ...prev, transactions: newTransactions, refunds: newRefunds };
      });
      
      return lastGroup;
    },
    undoCount,

    // Budget undo
    undoBudgetChange: () => {
      const lastSnapshot = budgetUndoStackRef.current.pop();
      setBudgetUndoCount(budgetUndoStackRef.current.length);
      if (!lastSnapshot) return null;
      setState(prev => {
        // El periodo viene guardado en el propio snapshot. Antes se deducia del
        // primer presupuesto y, si el snapshot estaba vacio, se usaba el mes en
        // pantalla: deshacer despues de cambiar de mes borraba el mes equivocado.
        const period = lastSnapshot.period !== undefined ? lastSnapshot.period : prev.currentDate;
        // Eliminar TODOS los presupuestos del periodo actual y reemplazar con el snapshot
        const otherBudgets = prev.budgets.filter(b => b.period !== period);
        return { ...prev, budgets: [...otherBudgets, ...lastSnapshot.budgets] };
      });
      return { label: lastSnapshot.label };
    },
    budgetUndoCount,
    getPeriodsWithBudgets: () => {
      const periods: string[] = Array.from(new Set(state.budgets.filter(b => isMonthKey(b.period)).map(b => b.period as string)));
      return periods.sort((a, b) => b.localeCompare(a));
    },
  }), [state, isGuest, isSyncing, syncError, undoCount, budgetUndoCount, getAccountHistoricalBalance, getSavingHistoricalBalance, getNetWorthHistorical, periodIndex, getPeriodAggregate, viewIndex, amountView, hasSharedAccounts, getOwnedAccountBalance, loginAsGuest, retrySync, manualRefresh, saveData, forceResync, syncRefundsWithTransactions]);

  if (isAppInitializing) { 
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="relative mb-6"><div className="w-20 h-20 border-4 border-blue-500/20 rounded-full border-t-blue-500 animate-spin"></div><Wallet className="absolute inset-0 m-auto text-blue-600 animate-pulse" size={32} /></div>
        <p className="text-slate-500 font-black uppercase tracking-[0.2em] text-[10px] animate-pulse">Sincronizando Bóveda Digital...</p>
        {(syncError || initializationTimeout) && ( 
          <div className="mt-4 flex flex-col items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-100 dark:border-amber-900/40 animate-in fade-in zoom-in duration-300 max-w-xs text-center"><AlertTriangle className="text-amber-600" size={24} /><p className="text-amber-600 text-xs font-medium">Tardando más de lo esperado. <br/> Probablemente la nube no responde, pero tienes tus datos locales seguros.</p><div className="flex gap-2 mt-2"><button onClick={() => window.location.reload()} className="p-2 px-4 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700">Recargar</button></div></div>
        )}
      </div>
    );
  }

  if (!session && !isGuest) return <Login onGuestLogin={loginAsGuest} />;

  return (
    <FinanceContext.Provider value={contextValue}>
      <HashRouter>
        <div className="flex h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-300 overflow-hidden text-slate-900 dark:text-slate-100 font-sans">
          <Sidebar isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} onLogout={logout} isGuest={isGuest} session={session} />
          <main className="flex-1 flex flex-col overflow-hidden relative">
            <Header onMenuClick={() => setIsMenuOpen(true)} />
            <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/savings" element={<Savings />} />
                <Route path="/wealth" element={<WealthProjections />} />
                <Route path="/refunds" element={<Refunds />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/budget" element={<BudgetManager />} />
                <Route path="/advisor" element={<AIAdvisor />} />
              </Routes>
            </div>
            <QuickAddButton />
          </main>
        </div>
      </HashRouter>
    </FinanceContext.Provider>
  );
};

const Sidebar = ({ isOpen, onClose, onLogout, isGuest, session }: { isOpen: boolean, onClose: () => void, onLogout: () => void, isGuest: boolean, session: any }) => {
  const location = useLocation();
  const { isSyncing, syncError, retrySync, manualRefresh, forceResync } = useFinance();
  const menuItems = [{ path: '/', icon: <LayoutDashboard size={20} />, label: 'Dashboard' }, { path: '/accounts', icon: <Wallet size={20} />, label: 'Cuentas' }, { path: '/savings', icon: <PiggyBank size={20} />, label: 'Ahorro' }, { path: '/wealth', icon: <LineChartIcon size={20} />, label: 'Proyecciones' }, { path: '/refunds', icon: <Receipt size={20} />, label: 'Reembolsos' }, { path: '/transactions', icon: <BarChart3 size={20} />, label: 'Transacciones' }, { path: '/budget', icon: <Receipt size={20} />, label: 'Presupuesto' }, { path: '/advisor', icon: <MessageSquare size={20} />, label: 'Asesor IA' }];
  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-slate-900/60 dark:bg-black/60 backdrop-blur-sm z-40 md:hidden" onClick={onClose} />}
      <aside className={`fixed md:static inset-y-0 left-0 w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shadow-xl md:shadow-sm z-50 flex flex-col transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-6 flex items-center justify-between"><h1 className="text-xl font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2"><div className="w-8 h-8 bg-blue-600 dark:bg-blue-50 rounded-lg flex items-center justify-center text-white"><Wallet size={18} /></div>Finanzas Pro</h1><button onClick={onClose} className="md:hidden p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button></div>
        <div className="mx-4 mb-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800">
             <div className="flex items-center gap-3 mb-2">{isGuest ? <Sparkles className="text-amber-500 shrink-0" size={16} /> : <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-black text-[10px] shrink-0">{session?.user?.email?.substring(0,2).toUpperCase()}</div>}<div className="flex-1 min-w-0"><p className="text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest truncate">{isGuest ? 'Modo Local' : session?.user?.email}</p><div className="flex items-center gap-1.5 mt-0.5">{isGuest ? <p className="text-[8px] text-amber-500 font-bold uppercase">Sin Sincronizar</p> : syncError ? <button onClick={retrySync} className="flex items-center gap-1 group"><CloudOff size={10} className="text-rose-500" /><p className="text-[8px] text-rose-500 font-bold uppercase group-hover:underline">Error de Red (Offline)</p></button> : isSyncing ? <><RefreshCw size={8} className="animate-spin text-blue-500" /><p className="text-[8px] text-blue-500 font-bold uppercase">Sincronizando...</p></> : <button onClick={manualRefresh} className="flex items-center gap-1 group hover:bg-slate-200 dark:hover:bg-slate-700 px-1.5 py-0.5 rounded transition-all"><CloudCheck size={10} className="text-emerald-500" /><p className="text-[8px] text-emerald-500 font-bold uppercase group-hover:underline">Sincronizado</p><RefreshCw size={8} className="text-slate-400 ml-1 opacity-0 group-hover:opacity-100" /></button>}</div></div></div>
             {syncError && !isGuest && <div className="flex items-center gap-2 mt-2 p-2 bg-rose-50 dark:bg-rose-900/20 rounded-xl border border-rose-100 dark:border-rose-900/40"><AlertTriangle className="text-rose-600" size={12} /><p className="text-[8px] text-rose-600 font-medium">Tus cambios se han guardado localmente.</p></div>}
             {!isGuest && <button onClick={forceResync} className="w-full mt-2 flex items-center justify-center gap-2 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"><RefreshCcw size={12} /> Sincronizar Nube</button>}
        </div>
        <nav className="flex-1 px-4 space-y-1 overflow-y-auto custom-scrollbar">{menuItems.map((item) => (<Link key={item.path} to={item.path} onClick={onClose} className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${location.pathname === item.path ? 'bg-blue-600 text-white font-semibold shadow-lg shadow-blue-100 dark:shadow-none' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200'}`}><span className="shrink-0">{item.icon}</span><span className="text-sm">{item.label}</span></Link>))}</nav>
        <div className="p-4 border-t border-slate-100 dark:border-slate-800"><button onClick={onLogout} className="w-full flex items-center gap-3 px-4 py-3 text-slate-500 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-xl transition-all font-bold text-sm"><LogOut size={20} /> Salir de la App</button></div>
      </aside>
    </>
  );
};

const Header = ({ onMenuClick }: { onMenuClick: () => void }) => {
  const { currentDate, changePeriod, setPeriod, viewMode, setViewMode, theme, toggleTheme, amountView, setAmountView, hasSharedAccounts } = useFinance();
  const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const [isPeriodDropdownOpen, setIsPeriodDropdownOpen] = useState(false);
  const currentFormatted = useMemo(() => {
    if (viewMode === 'year') return `Año ${currentDate}`;
    const parts = currentDate.split('-').map(Number);
    return parts.length === 2 ? `${monthNames[parts[1] - 1] || ''} ${parts[0]}` : currentDate;
  }, [currentDate, viewMode]);
  return (
    <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 h-16 flex items-center justify-between px-4 md:px-6 sticky top-0 z-40 transition-all duration-300">
      <div className="flex items-center gap-3"><button onClick={onMenuClick} className="md:hidden p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"><Menu size={22} /></button>
        <div className="flex items-center gap-2"><div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl shadow-inner mr-2"><button onClick={() => setViewMode('month')} className={`p-1.5 rounded-lg transition-all ${viewMode === 'month' ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-400'}`}><CalendarDays size={18} /></button><button onClick={() => setViewMode('year')} className={`p-1.5 rounded-lg transition-all ${viewMode === 'year' ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-400'}`}><CalendarRange size={18} /></button></div>
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl shadow-inner relative"><button onClick={() => changePeriod(-1)} className="p-1 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-all dark:text-slate-400"><ChevronLeft size={18} /></button><button onClick={() => setIsPeriodDropdownOpen(!isPeriodDropdownOpen)} className="px-3 py-1.5 text-xs font-black text-slate-700 dark:text-slate-300 min-w-[110px] text-center uppercase tracking-wider cursor-pointer hover:bg-white/50 dark:hover:bg-slate-700/50 rounded-lg">{currentFormatted}</button><button onClick={() => changePeriod(1)} className="p-1 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-all dark:text-slate-400"><ChevronRight size={18} /></button>
            {isPeriodDropdownOpen && <PeriodDropdown currentDate={currentDate} viewMode={viewMode} setPeriod={(date) => { setPeriod(date); setIsPeriodDropdownOpen(false); }} onClose={() => setIsPeriodDropdownOpen(false)} />}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {hasSharedAccounts && (
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl shadow-inner" title="En las cuentas compartidas, elige si ver el importe completo de la cuenta o solo la parte que te corresponde.">
            <button onClick={() => setAmountView('mine')} className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${amountView === 'mine' ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}>Mi parte</button>
            <button onClick={() => setAmountView('full')} className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${amountView === 'full' ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}>Completo</button>
          </div>
        )}
        <button onClick={toggleTheme} className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shadow-sm transition-all">{theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}</button>
      </div>
    </header>
  );
};

const PeriodDropdown: React.FC<{ currentDate: string; viewMode: 'month' | 'year'; setPeriod: (date: string) => void; onClose: () => void; }> = ({ currentDate, viewMode, setPeriod, onClose }) => {
  const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const currentYear = parseInt(currentDate.substring(0, 4));
  const currentMonth = viewMode === 'month' && currentDate.length === 7 ? parseInt(currentDate.substring(5, 7)) - 1 : -1;
  const [yearPage, setYearPage] = useState(currentYear);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (overlayRef.current && overlayRef.current === event.target) onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div ref={overlayRef} className="fixed inset-0 z-[100] flex items-start justify-center" style={{ paddingTop: '72px' }}>
      <div 
        ref={dropdownRef} 
        className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 p-5 w-[340px] max-w-[95vw]"
        style={{ animation: 'fadeSlideIn 0.2s ease-out' }}
      >
        {/* Year Navigation */}
        <div className="flex items-center justify-between mb-4 px-1">
          <button onClick={() => setYearPage(y => y - 1)} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-all active:scale-90">
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-black text-slate-800 dark:text-white tracking-wider uppercase">{yearPage}</span>
          <button onClick={() => setYearPage(y => y + 1)} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-all active:scale-90">
            <ChevronRight size={18} />
          </button>
        </div>

        {viewMode === 'month' ? (
          <div className="grid grid-cols-3 gap-2">
            {monthNames.map((name, index) => {
               const isSelected = index === currentMonth && yearPage === currentYear;
               return (
                 <button 
                   key={index} 
                   onClick={() => setPeriod(`${yearPage}-${String(index + 1).padStart(2, '0')}`)}
                   className={`px-3 py-3 text-xs font-bold rounded-2xl transition-all duration-150 active:scale-95 ${
                     isSelected 
                       ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 dark:shadow-blue-900/50' 
                       : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                   }`}
                 >
                   {name}
                 </button>
               );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 9 }, (_, i) => yearPage - 4 + i).map(year => {
              const isSelected = year === currentYear;
              return (
                <button 
                  key={year} 
                  onClick={() => setPeriod(year.toString())}
                  className={`px-3 py-3 text-xs font-bold rounded-2xl transition-all duration-150 active:scale-95 ${
                    isSelected 
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 dark:shadow-blue-900/50' 
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {year}
                </button>
              );
            })}
          </div>
        )}

        {/* Quick Today button */}
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button 
            onClick={() => {
              const now = new Date();
              if (viewMode === 'month') setPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
              else setPeriod(now.getFullYear().toString());
            }}
            className="w-full py-2.5 text-[11px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all"
          >
            Ir a Hoy
          </button>
        </div>
      </div>
    </div>
  );
};

const QuickAddButton = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="fixed bottom-6 right-6 md:bottom-8 md:right-8 z-40">
      {open && (
        <div className="absolute bottom-16 right-0 mb-2 flex flex-col gap-2 animate-in slide-in-from-bottom-4 duration-300">
          <button onClick={() => { setOpen(false); navigate('/transactions', { state: { triggerScan: true } }); }} className="flex items-center gap-3 bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-5 py-4 rounded-2xl shadow-xl border border-blue-100 dark:border-blue-800 whitespace-nowrap group"><Camera size={20} /> <span className="text-sm font-black uppercase tracking-widest">Aura Vision</span></button>
          <button onClick={() => { setOpen(false); navigate('/transactions', { state: { openModal: true } }); }} className="flex items-center gap-3 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-5 py-4 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-700 whitespace-nowrap"><Receipt size={20} /> <span className="text-sm font-black uppercase tracking-widest">Nuevo Movimiento</span></button>
          <button onClick={() => { setOpen(false); navigate('/advisor'); }} className="flex items-center gap-3 bg-blue-600 text-white px-5 py-4 rounded-2xl shadow-xl hover:bg-blue-700 transition-all"><MessageSquare size={20} /> <span className="text-sm font-black uppercase tracking-widest">Hablar con Aura</span></button>
        </div>
      )}
      <button onClick={() => setOpen(!open)} className={`w-14 h-14 md:w-16 md:h-16 rounded-[1.2rem] shadow-2xl flex items-center justify-center transition-all duration-300 ${open ? 'bg-slate-800 rotate-45 shadow-none' : 'bg-blue-600'}`}><Plus size={32} className="text-white" /></button>
    </div>
  );
};
export default App;
