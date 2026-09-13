
export type TransactionType = 'income' | 'expense';

export interface Account {
  id: string;
  name: string;
  type: 'Bank' | 'Cash' | 'Card';
  initialBalance: number;
  currentBalance: number;
  color: string;
  emoji?: string;
  // Titularidad parcial (cuenta o hucha compartida, p.ej. con la pareja).
  // Ausente = 100% tuya, que es como se comportaba todo hasta ahora.
  // Solo afecta a las vistas de analisis: el saldo y los movimientos se
  // registran siempre integros para que cuadren con el extracto del banco.
  ownershipPercent?: number;
}

export interface Saving {
  id: string;
  name: string;
  currentAmount: number;
  targetAmount?: number;
  isInvestment: boolean;
  growthRate?: number;
  color: string;
  emoji?: string;
  // Titularidad parcial (cuenta o hucha compartida, p.ej. con la pareja).
  // Ausente = 100% tuya, que es como se comportaba todo hasta ahora.
  // Solo afecta a las vistas de analisis: el saldo y los movimientos se
  // registran siempre integros para que cuadren con el extracto del banco.
  ownershipPercent?: number;
}

export interface Refund {
  id: string;
  name: string;
  totalAmount: number;
  paidByMe: number;
  pendingAmount: number;
  status: 'open' | 'closed';
  notes: string;
  date: string;
  category: string;
  originTransactionId?: string;
  // Cobrado a mano (efectivo, Bizum sin registrar). Protege pendingAmount del
  // recalculo automatico, que si no lo devolveria a la deuda integra.
  settledManually?: boolean;
}

export interface Transaction {
  id: string;
  date: string;
  amount: number;
  description: string;
  category: string;
  type: TransactionType;
  accountId: string;
  isRefund: boolean;
  refundId?: string;
  savingId?: string; // Nuevo: Vínculo con hucha
  image?: string;
  emoji?: string;
}

export interface Budget {
  id: string;
  category: string;
  limit: number;
  icon: string;
  spent: number;
  // 'saving' es un objetivo de aportacion mensual a una hucha (savingId).
  type: 'income' | 'expense' | 'saving';
  color: string; // Color personalizado para la categoría
  period?: string; // YYYY-MM
  savingId?: string;
}

/** Informe de Aura guardado para un periodo. Solo se escribe al pedirlo el usuario. */
export interface AuraReport {
  kind: 'progress' | 'summary' | 'future';
  generatedAt: string;
  txCount: number;
  titular: string;
  puntos: string[];
  consejo: string;
}

export interface AIChallenge {
  id: string;
  title: string;
  target: number;
  type: 'spending_limit' | 'savings_goal' | 'income_target';
  category?: string;
  completed: boolean;
}

export interface ExtraSaving {
  id: string;
  label: string;
  amount: number;
  year: number;
  isRecurring: boolean;
}

export interface ChatMessage {
  role: 'ai' | 'user' | 'system';
  text: string;
}

export interface FinanceState {
  accounts: Account[];
  savings: Saving[];
  refunds: Refund[];
  transactions: Transaction[];
  budgets: Budget[];
  challenges: AIChallenge[];
  extraSavings: ExtraSaving[];
  manualContributions: Record<string, number>;
  currentDate: string; // YYYY-MM o YYYY
  viewMode: 'month' | 'year';
  dashboardLayout: string[]; 
  theme: 'light' | 'dark';
  chatHistory: ChatMessage[];
  chatLastDate: string; // YYYY-MM-DD
  // Categorias retiradas a mano de un mes (periodo -> claves de presupuesto), para
  // que no reaparezcan heredadas. Opcional: los estados antiguos no lo tienen.
  budgetExclusions?: Record<string, string[]>;
  auraReports?: Record<string, AuraReport>;
}
