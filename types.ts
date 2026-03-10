
export type TransactionType = 'income' | 'expense';

export interface Account {
  id: string;
  name: string;
  type: 'Bank' | 'Cash' | 'Card';
  initialBalance: number;
  currentBalance: number;
  color: string;
  emoji?: string;
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
  type: 'income' | 'expense';
  color: string; // Color personalizado para la categoría
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
}
