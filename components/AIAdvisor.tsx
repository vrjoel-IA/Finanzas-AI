
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useFinance } from '../App';
import { Send, Bot, User, Sparkles, Loader2, RefreshCcw, CheckCircle2, TrendingUp } from 'lucide-react';
import { getFinancialAdviceWithTools } from '../services/geminiService';
import { ChatMessage } from '../types';

const AIAdvisor: React.FC = () => {
  const financeState = useFinance();
  const { budgets, updateBudget, addTransaction, addBudget, accounts, transactions, theme, currentDate, chatHistory, chatLastDate, updateChatHistory } = financeState;
  
  const welcomeMessage: ChatMessage = { 
    role: 'ai', 
    text: 'Bienvenido al Centro de Estrategia Financiera Aura.\n\nHe integrado las metodologías de Presupuesto Base Cero y la Regla del Tercio en mi núcleo. Analizaré tu histórico anual para optimizar tu próximo ciclo.\n\nAntes de empezar, ¿cuál es tu mayor reto financiero para este mes?' 
  };

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Carga inicial y lógica de reset diario
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    if (chatLastDate !== today) {
      // Es un nuevo día o nunca se ha hablado, empezamos de cero
      setMessages([welcomeMessage]);
      updateChatHistory([welcomeMessage]);
    } else if (chatHistory && chatHistory.length > 0) {
      // Respetamos la conversación del día actual
      setMessages(chatHistory);
    } else {
      setMessages([welcomeMessage]);
    }
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const historicalContext = useMemo(() => {
    const categories: Record<string, { total: number, count: number }> = {};
    const monthlyBalances: Record<string, number> = {};

    transactions.forEach(t => {
      const month = t.date.substring(0, 7);
      if (t.type === 'expense') {
        if (!categories[t.category]) categories[t.category] = { total: 0, count: 0 };
        categories[t.category].total += t.amount;
        categories[t.category].count += 1;
      }
      monthlyBalances[month] = (monthlyBalances[month] || 0) + (t.type === 'income' ? t.amount : -t.amount);
    });

    const averages = Object.keys(categories).map(cat => 
        `${cat}: Media de ${(categories[cat].total / Math.max(1, Object.keys(monthlyBalances).length)).toFixed(2)}€/mes`
    ).join(', ');

    return `Resumen Histórico Anual: Promedios por Categoría: ${averages}. Saldos Mensuales Pasados: ${Object.entries(monthlyBalances).map(([m, b]) => `${m}: ${b}€`).join(' | ')}`;
  }, [transactions]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg = input.trim();
    setInput('');
    const newHistory: ChatMessage[] = [...messages, { role: 'user', text: userMsg }];
    setMessages(newHistory);
    setIsLoading(true);

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
        return `${b.category} (${b.type}): ${calculatedSpent}/${b.limit}€`;
      }).join(', ');

      const context = `${historicalContext}. Estado Actual (${financeState.currentDate}): Cuentas: ${accounts.map(a => `${a.name} (${financeState.getAccountHistoricalBalance(a.id, currentDate)}€)`).join(', ')}. Presupuestos Actuales: ${budgetsInfo}`;

      const response = await getFinancialAdviceWithTools(context, userMsg);
      let updatedList = [...newHistory];
      let systemFeedbacks: string[] = [];

      if (response.functionCalls) {
        for (const fc of response.functionCalls) {
          if (fc.name === 'createBudgetCategory') {
            const { categoryName, limit, type } = fc.args as any;
            if (categoryName.toLowerCase().includes('ahorro')) {
                systemFeedbacks.push(`⚠️ Aura: El ahorro se gestiona como transferencia estratégica a huchas, no como presupuesto de gasto.`);
            } else {
                addBudget({ category: categoryName, limit, type: type as 'income' | 'expense', color: '#3b82f6', icon: 'ShoppingBag' });
                systemFeedbacks.push(`✨ Estrategia Base Cero: Nueva categoría "${categoryName}" fijada en ${limit}€.`);
            }
          }
          if (fc.name === 'updateExistingBudgetLimit') {
            const { categoryName, newLimit } = fc.args as any;
            const budget = budgets.find(b => b.category.toLowerCase().trim() === categoryName.toLowerCase().trim());
            if (budget) {
              updateBudget({ ...budget, limit: newLimit });
              systemFeedbacks.push(`✅ Optimización: Límite de "${budget.category}" ajustado a ${newLimit}€ según análisis.`);
            }
          }
          if (fc.name === 'recordNewTransaction') {
            const { description, amount, category, type, accountName } = fc.args as any;
            const account = accounts.find(a => a.name.toLowerCase().trim() === accountName.toLowerCase().trim());
            if (account) {
              addTransaction({ date: new Date().toISOString().split('T')[0], amount, description, category, type: type === 'income' ? 'income' : 'expense', accountId: account.id, isRefund: false });
              systemFeedbacks.push(`💸 Registro Activo: ${description} (${amount}€) en ${account.name}.`);
            }
          }
        }
      }

      if (systemFeedbacks.length > 0) {
        const sysMsg: ChatMessage = { role: 'system', text: systemFeedbacks.join('\n') };
        updatedList.push(sysMsg);
      }
      if (response.text) {
        const aiMsg: ChatMessage = { role: 'ai', text: response.text || '' };
        updatedList.push(aiMsg);
      }

      setMessages(updatedList);
      updateChatHistory(updatedList);
    } catch (err) {
      console.error(err);
      const errMsg: ChatMessage = { role: 'ai', text: 'Error en los protocolos de análisis. Por favor, reinicia la consulta.' };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const formatText = (text: string) => {
    return text.split('\n').map((line, i) => {
      const formattedLine = line.replace(/\*\*(.*?)\*\*/g, `<strong class="font-black text-slate-900 dark:text-white transition-colors">$1</strong>`).replace(/\*(.*?)\*/g, `<em class="text-blue-600 dark:text-blue-400 font-bold transition-colors">$1</em>`);
      const isQuestion = line.includes('?') && line.trim().length > 10;
      return (<p key={i} className={`${isQuestion ? 'bg-blue-100/50 dark:bg-blue-900/20 p-3 rounded-xl border-l-4 border-blue-500 dark:border-blue-400 my-2' : 'mb-3'} min-h-[1em] transition-colors`} dangerouslySetInnerHTML={{ __html: formattedLine }} />);
    });
  };

  return (
    <div className="h-full flex flex-col max-w-4xl mx-auto space-y-4 transition-colors">
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-slate-900 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-white shadow-2xl transition-colors"><Bot size={28} /></div>
          <div>
            <h2 className="text-xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2 transition-colors">Aura Financial Strategy <Sparkles className="text-amber-500" size={18} /></h2>
            <div className="flex items-center gap-2"><span className="flex h-2 w-2 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse"></span><p className="text-slate-400 dark:text-slate-500 font-bold text-[9px] uppercase tracking-[0.2em]">Consultoría Diaria Sincronizada</p></div>
          </div>
        </div>
        <button onClick={() => { setMessages([welcomeMessage]); updateChatHistory([welcomeMessage]); }} className="p-4 text-slate-400 dark:text-slate-600 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-white dark:hover:bg-slate-800 rounded-2xl transition-all shadow-sm border border-transparent hover:border-slate-100 dark:hover:border-slate-800" title="Reiniciar Estrategia"><RefreshCcw size={18} /></button>
      </div>
      <div className="flex-1 bg-white dark:bg-slate-900 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-2xl shadow-slate-200/50 dark:shadow-none flex flex-col overflow-hidden relative border-t-8 border-t-slate-900 dark:border-t-slate-800 transition-colors">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 md:p-12 space-y-12 custom-scrollbar transition-colors">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-6 duration-700`}>
              <div className={`flex gap-6 max-w-[95%] md:max-w-[85%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {m.role !== 'system' && (<div className={`w-12 h-12 rounded-2xl flex-shrink-0 flex items-center justify-center shadow-lg transition-colors ${m.role === 'ai' ? 'bg-slate-900 dark:bg-slate-800 text-white' : 'bg-blue-600 dark:bg-blue-500 text-white'}`}>{m.role === 'ai' ? <TrendingUp size={24} /> : <User size={24} />}</div>)}
                <div className={`p-8 rounded-[2.5rem] text-[14px] md:text-[15px] leading-relaxed shadow-sm border transition-all duration-300 ${m.role === 'ai' ? 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-100 dark:border-slate-700 rounded-tl-none' : m.role === 'system' ? 'bg-amber-50/50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 border-amber-100 dark:border-amber-900/50 border-dashed font-bold italic mx-auto text-center w-full rounded-2xl py-4 px-8' : 'bg-blue-600 dark:bg-blue-500 text-white font-medium shadow-blue-200 dark:shadow-none border-blue-500 dark:border-blue-400 rounded-tr-none'}`}>{formatText(m.text)}</div>
              </div>
            </div>
          ))}
          {isLoading && (<div className="flex justify-start"><div className="flex gap-4 items-center"><div className="w-12 h-12 rounded-2xl bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-center animate-pulse transition-colors"><Bot size={24} /></div><div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 flex items-center gap-4 transition-colors"><Loader2 size={20} className="animate-spin text-blue-600 dark:text-blue-400" /><span className="text-[11px] text-slate-400 dark:text-slate-500 font-black uppercase tracking-[0.3em]">Aura comparando histórico anual...</span></div></div></div>)}
        </div>
        <div className="p-8 bg-slate-50/80 dark:bg-slate-900/80 border-t border-slate-100 dark:border-slate-800 backdrop-blur-md transition-colors"><div className="bg-white dark:bg-slate-800 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-2xl p-3 flex items-center gap-4 focus-within:ring-4 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/40 transition-all group"><input type="text" placeholder="Habla con tu asesora estratégica..." className="flex-1 bg-transparent border-none focus:ring-0 text-[15px] px-6 py-4 font-medium text-slate-700 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 transition-colors" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} /><button onClick={handleSend} disabled={isLoading || !input.trim()} className={`p-5 rounded-2xl transition-all ${!input.trim() || isLoading ? 'bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-700' : 'bg-slate-900 dark:bg-blue-600 text-white shadow-xl hover:bg-black dark:hover:bg-blue-500 active:scale-95'}`}><Send size={24} /></button></div></div>
      </div>
    </div>
  );
};

export default AIAdvisor;
