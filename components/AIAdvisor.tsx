
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useFinance } from '../App';
import { Send, Bot, User, Sparkles, Loader2, RefreshCcw, CheckCircle2, TrendingUp } from 'lucide-react';
import { getFinancialAdviceWithTools } from '../services/geminiService';
import { ChatMessage } from '../types';
import AdvisorText from './AdvisorText';
import { AdvisorProposal, prepareAdvisorProposal, applyAdvisorProposal, needsConfirmation } from './advisorActions';
import { buildAdvisorContext } from './advisorContext';

const AIAdvisor: React.FC = () => {
  const financeState = useFinance();
  const {
    transactions, currentDate, chatHistory, chatLastDate, updateChatHistory,
    setPeriod, setViewMode, toggleTheme,
    addBudget, updateBudget, deleteBudget, importBudgetFromMonth,
    addTransaction, updateTransaction, deleteTransaction,
    addSaving, updateSaving, deleteSaving,
    addAccount, updateAccount, addRefund, updateRefund,
  } = financeState;

  // Todo lo que Aura puede llegar a ejecutar, en un solo sitio.
  const advisorCallbacks = {
    setPeriod, setViewMode, toggleTheme,
    addBudget, updateBudget, deleteBudget, importBudgetFromMonth,
    addTransaction, updateTransaction, deleteTransaction,
    addSaving, updateSaving, deleteSaving,
    addAccount, updateAccount, addRefund, updateRefund,
  };
  
  const welcomeMessage: ChatMessage = { 
    role: 'ai', 
    text: 'Bienvenido al Centro de Estrategia Financiera Aura.\n\nHe integrado las metodologías de Presupuesto Base Cero y la Regla del Tercio en mi núcleo. Analizaré tu histórico anual para optimizar tu próximo ciclo.\n\nAntes de empezar, ¿cuál es tu mayor reto financiero para este mes?' 
  };

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [proposals, setProposals] = useState<AdvisorProposal[]>([]);
  const [actionNotice, setActionNotice] = useState('');
  const nextProposalId = useRef(0);
  const consumedProposals = useRef(new Set<number>());
  const requestInProgress = useRef(false);
  const requestVersion = useRef(0);

  useEffect(() => () => { requestVersion.current += 1; }, []);

  const discardProposals = () => {
    proposals.forEach(proposal => consumedProposals.current.add(proposal.id));
    setProposals([]);
  };

  const confirmProposal = (proposal: AdvisorProposal) => {
    if (consumedProposals.current.has(proposal.id)) return;
    // Consume the whole response before calling a setter, including rapid repeated clicks.
    discardProposals();
    try {
      applyAdvisorProposal(proposal, financeState, advisorCallbacks);
      setActionNotice(`Cambio confirmado: ${proposal.summary} Las demás propuestas de esta respuesta se han descartado.`);
    } catch (error) {
      setActionNotice(error instanceof Error ? error.message : 'No se ha podido aplicar la propuesta.');
    }
  };

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

  // Foto financiera completa. Antes Aura solo veia saldos y limites, asi que no
  // podia responder sobre gastos concretos, huchas ni reembolsos.
  const advisorContext = useMemo(() => buildAdvisorContext({
    accounts: financeState.accounts,
    savings: financeState.savings,
    budgets: financeState.budgets,
    transactions: financeState.transactions,
    refunds: financeState.refunds,
    challenges: financeState.challenges,
    currentDate: financeState.currentDate,
    viewMode: financeState.viewMode,
    accountBalance: financeState.getAccountHistoricalBalance,
    savingBalance: financeState.getSavingHistoricalBalance,
    netWorth: financeState.getNetWorthHistorical,
  }), [financeState]);

  const handleSend = async () => {
    if (!input.trim() || isLoading || requestInProgress.current || proposals.length) return;
    requestInProgress.current = true;
    const version = ++requestVersion.current;
    setActionNotice('');

    const userMsg = input.trim();
    setInput('');
    const newHistory: ChatMessage[] = [...messages, { role: 'user', text: userMsg }];
    setMessages(newHistory);
    setIsLoading(true);

    try {
      // El historial hace que Aura pueda conversar: antes cada mensaje viajaba solo.
      const history = newHistory
        .filter(m => m.role === 'ai' || m.role === 'user')
        .map(m => ({ role: m.role, text: m.text }));

      const response = await getFinancialAdviceWithTools(advisorContext, userMsg, history);
      if (version !== requestVersion.current) return;
      let updatedList = [...newHistory];
      let systemFeedbacks: string[] = [];
      const pending: AdvisorProposal[] = [];

      if (response.functionCalls) {
        for (const fc of response.functionCalls) {
          try {
            const proposal = prepareAdvisorProposal(fc.name || '', fc.args, financeState, ++nextProposalId.current, new Date().toISOString().split('T')[0]);
            // La navegacion no toca datos y es reversible: pedir confirmacion seria un estorbo.
            if (!needsConfirmation(proposal)) {
              applyAdvisorProposal(proposal, financeState, advisorCallbacks);
              systemFeedbacks.push(proposal.summary);
            } else {
              pending.push(proposal);
            }
          } catch (error) {
            systemFeedbacks.push(`Propuesta no aplicada: ${error instanceof Error ? error.message : 'Datos no válidos.'}`);
          }
        }
      }
      setProposals(pending);
      if (pending.length) systemFeedbacks.push('Hay propuestas pendientes de confirmación. No se ha modificado ningún dato.');

      if (systemFeedbacks.length > 0) {
        const sysMsg: ChatMessage = { role: 'system', text: systemFeedbacks.join('\n') };
        updatedList.push(sysMsg);
      }
      // Cuando Gemini devuelve una llamada a herramienta suprime el texto, asi que
      // aqui no suele haber nada que mostrar: la explicacion vive en el resumen de
      // la propuesta, que describe exactamente lo que va a pasar.
      if (response.text) {
        const aiMsg: ChatMessage = { role: 'ai', text: response.text || '' };
        updatedList.push(aiMsg);
      }

      setMessages(updatedList);
      updateChatHistory(updatedList);
    } catch (err) {
      if (version !== requestVersion.current) return;
      console.error(err);
      const errMsg: ChatMessage = { role: 'ai', text: 'Error en los protocolos de análisis. Por favor, reinicia la consulta.' };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      if (version === requestVersion.current) {
        requestInProgress.current = false;
        setIsLoading(false);
      }
    }
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
        <button disabled={isLoading} onClick={() => { discardProposals(); setActionNotice(''); setMessages([welcomeMessage]); updateChatHistory([welcomeMessage]); }} className="p-4 text-slate-400 dark:text-slate-600 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-white dark:hover:bg-slate-800 rounded-2xl transition-all shadow-sm border border-transparent hover:border-slate-100 dark:hover:border-slate-800" title="Reiniciar Estrategia"><RefreshCcw size={18} /></button>
      </div>
      <div className="flex-1 bg-white dark:bg-slate-900 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-2xl shadow-slate-200/50 dark:shadow-none flex flex-col overflow-hidden relative border-t-8 border-t-slate-900 dark:border-t-slate-800 transition-colors">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 md:p-12 space-y-12 custom-scrollbar transition-colors">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-6 duration-700`}>
              <div className={`flex gap-6 max-w-[95%] md:max-w-[85%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {m.role !== 'system' && (<div className={`w-12 h-12 rounded-2xl flex-shrink-0 flex items-center justify-center shadow-lg transition-colors ${m.role === 'ai' ? 'bg-slate-900 dark:bg-slate-800 text-white' : 'bg-blue-600 dark:bg-blue-500 text-white'}`}>{m.role === 'ai' ? <TrendingUp size={24} /> : <User size={24} />}</div>)}
                <div className={`p-8 rounded-[2.5rem] text-[14px] md:text-[15px] leading-relaxed shadow-sm border transition-all duration-300 ${m.role === 'ai' ? 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-100 dark:border-slate-700 rounded-tl-none' : m.role === 'system' ? 'bg-amber-50/50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 border-amber-100 dark:border-amber-900/50 border-dashed font-bold italic mx-auto text-center w-full rounded-2xl py-4 px-8' : 'bg-blue-600 dark:bg-blue-500 text-white font-medium shadow-blue-200 dark:shadow-none border-blue-500 dark:border-blue-400 rounded-tr-none'}`}><AdvisorText text={m.text} /></div>
              </div>
            </div>
          ))}
          {proposals.length > 0 && (
            <section aria-label="Propuestas de Aura" className="space-y-4 rounded-2xl border border-amber-300 dark:border-amber-700 p-5">
              <p className="font-bold">Revisa antes de confirmar</p>
              <p className="text-sm">No se ha modificado ningún dato. Confirma una propuesta o descártala para continuar. Al confirmar una, se descartan las demás.</p>
              {proposals.map(proposal => {
                const isDestructive = proposal.tier === 'destructive';
                return (
                  <div key={proposal.id} className={`space-y-3 border-t pt-4 ${isDestructive ? 'border-red-300 dark:border-red-800' : 'border-amber-200 dark:border-amber-800'}`}>
                    {isDestructive && (
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-red-600 dark:text-red-400">Acción destructiva</p>
                    )}
                    <p className="text-sm whitespace-pre-wrap">{proposal.summary}</p>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => confirmProposal(proposal)}
                        className={`rounded-xl px-4 py-3 font-bold text-white ${isDestructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                      >
                        {isDestructive ? 'Sí, borrar definitivamente' : 'Confirmar este cambio'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { consumedProposals.current.add(proposal.id); setProposals(prev => prev.filter(p => p.id !== proposal.id)); }}
                        className="rounded-xl border border-slate-300 px-4 py-3 font-bold"
                      >
                        Descartar
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>
          )}
          {actionNotice && <p role="status" className="rounded-2xl border border-slate-300 p-4 text-sm">{actionNotice}</p>}
          {isLoading && (<div className="flex justify-start"><div className="flex gap-4 items-center"><div className="w-12 h-12 rounded-2xl bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-center animate-pulse transition-colors"><Bot size={24} /></div><div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 flex items-center gap-4 transition-colors"><Loader2 size={20} className="animate-spin text-blue-600 dark:text-blue-400" /><span className="text-[11px] text-slate-400 dark:text-slate-500 font-black uppercase tracking-[0.3em]">Aura comparando histórico anual...</span></div></div></div>)}
        </div>
        <div className="p-8 bg-slate-50/80 dark:bg-slate-900/80 border-t border-slate-100 dark:border-slate-800 backdrop-blur-md transition-colors"><div className="bg-white dark:bg-slate-800 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-2xl p-3 flex items-center gap-4 focus-within:ring-4 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/40 transition-all group"><input type="text" placeholder="Habla con tu asesora estratégica..." className="flex-1 bg-transparent border-none focus:ring-0 text-[15px] px-6 py-4 font-medium text-slate-700 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 transition-colors" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} /><button onClick={handleSend} disabled={isLoading || proposals.length > 0 || !input.trim()} className={`p-5 rounded-2xl transition-all ${!input.trim() || isLoading || proposals.length > 0 ? 'bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-700' : 'bg-slate-900 dark:bg-blue-600 text-white shadow-xl hover:bg-black dark:hover:bg-blue-500 active:scale-95'}`}><Send size={24} /></button></div></div>
      </div>
    </div>
  );
};

export default AIAdvisor;
