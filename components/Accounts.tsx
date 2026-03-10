
import React, { useState } from 'react';
import { useFinance } from '../App';
import { Plus, Trash2, Edit2, ArrowRightLeft, CreditCard, Banknote, Landmark, X, Check } from 'lucide-react';
import { Account } from '../types';

const Accounts: React.FC = () => {
  const { accounts, currentDate, getAccountHistoricalBalance, addAccount, updateAccount, deleteAccount, addTransaction, theme } = useFinance();
  const [isAdding, setIsAdding] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  
  // New/Edit account form state
  const [name, setName] = useState('');
  const [type, setType] = useState<Account['type']>('Bank');
  const [balanceInput, setBalanceInput] = useState<number | ''>('');
  const [color, setColor] = useState('#3b82f6');
  const [emoji, setEmoji] = useState('🏦');

  // Transfer form
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [transferAmount, setTransferAmount] = useState<number | ''>('');

  const resetForm = () => {
    setName('');
    setType('Bank');
    setBalanceInput('');
    setColor('#3b82f6');
    setEmoji('🏦');
  };

  const handleOpenAdd = () => {
    resetForm();
    setIsAdding(true);
  };

  const handleOpenEdit = (acc: Account) => {
    setName(acc.name);
    setType(acc.type);
    setBalanceInput(acc.initialBalance);
    setColor(acc.color);
    setEmoji(acc.emoji || '🏦');
    setEditingAccount(acc);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalBalance = balanceInput === '' ? 0 : balanceInput;
    if (editingAccount) {
      updateAccount({ 
        ...editingAccount, 
        name, 
        type, 
        initialBalance: finalBalance, 
        color, 
        emoji 
      });
      setEditingAccount(null);
    } else {
      addAccount({ 
        name, 
        type, 
        initialBalance: finalBalance, 
        color, 
        emoji 
      });
      setIsAdding(false);
    }
    resetForm();
  };

  const handleTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    const amountValue = transferAmount === '' ? 0 : transferAmount;
    if (!fromId || !toId) return alert("Selecciona ambas cuentas");
    if (fromId === toId) return alert("Las cuentas deben ser diferentes");
    if (amountValue <= 0) return alert("Introduce una cantidad válida");
    
    const date = new Date().toISOString().split('T')[0];
    addTransaction({
      date,
      amount: amountValue,
      description: `Transferencia a ${accounts.find(a => a.id === toId)?.name}`,
      category: 'Traspaso',
      type: 'expense',
      accountId: fromId,
      isRefund: false
    });
    addTransaction({
      date,
      amount: amountValue,
      description: `Transferencia desde ${accounts.find(a => a.id === fromId)?.name}`,
      category: 'Traspaso',
      type: 'income',
      accountId: toId,
      isRefund: false
    });

    setIsTransferring(false);
    setTransferAmount('');
    setFromId('');
    setToId('');
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20 transition-colors">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-800 dark:text-white tracking-tight">Cuentas y Efectivo</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium tracking-tight">Gestiona tu liquidez. Mostrando saldos de {currentDate}.</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setIsTransferring(true)}
            className="flex items-center gap-2 px-6 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm active:scale-95"
          >
            <ArrowRightLeft size={18} />
            Transferir
          </button>
          <button 
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 dark:shadow-none active:scale-95"
          >
            <Plus size={18} />
            Nueva Cuenta
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {accounts.map(acc => {
          const displayBalance = getAccountHistoricalBalance(acc.id, currentDate);
          const isConfirming = confirmDeleteId === acc.id;
          return (
            <div key={acc.id} className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 border border-slate-100 dark:border-slate-800 shadow-sm relative group overflow-hidden hover:shadow-md transition-all duration-300">
              <div className="flex justify-between items-start mb-6">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-inner dark:shadow-none" style={{ backgroundColor: `${acc.color}${theme === 'dark' ? '30' : '20'}` }}>
                  {acc.emoji || (acc.type === 'Bank' ? '🏦' : acc.type === 'Cash' ? '💵' : '💳')}
                </div>
                <div className={`flex gap-1 transition-opacity ${isConfirming ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                  {!isConfirming ? (
                    <>
                      <button 
                        onClick={() => handleOpenEdit(acc)}
                        className="p-2.5 hover:bg-blue-50 dark:hover:bg-blue-900/40 rounded-xl text-blue-500 transition-colors"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        onClick={() => setConfirmDeleteId(acc.id)}
                        className="p-2.5 hover:bg-rose-50 dark:hover:bg-rose-900/40 rounded-xl text-rose-400 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </>
                  ) : (
                    <div className="flex gap-1 items-center animate-in slide-in-from-right-2">
                       <button 
                        onClick={() => { deleteAccount(acc.id); setConfirmDeleteId(null); }}
                        className="flex items-center gap-1 px-3 py-1.5 bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-700 transition-all"
                      >
                        <Check size={14} /> Confirmar
                      </button>
                      <button 
                        onClick={() => setConfirmDeleteId(null)}
                        className="p-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 transition-all"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              
              <h4 className="text-xl font-bold text-slate-800 dark:text-slate-100">{acc.name}</h4>
              <p className="text-xs text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mb-4">{acc.type}</p>
              
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-slate-900 dark:text-white">{displayBalance.toLocaleString('es-ES')}€</span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">Saldo en {currentDate}</span>
              </div>
            </div>
          );
        })}
      </div>

      {(isAdding || editingAccount) && (
        <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] w-full max-w-md p-10 shadow-2xl animate-in fade-in zoom-in duration-300 overflow-y-auto max-h-[90vh] border border-transparent dark:border-slate-800">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100">{editingAccount ? 'Editar Cuenta' : 'Nueva Cuenta'}</h3>
              <button onClick={() => { setIsAdding(false); setEditingAccount(null); }} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full">
                <X size={20} className="text-slate-400" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Nombre de la cuenta</label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={e => setName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium text-slate-900 dark:text-slate-100" 
                  placeholder="Ej: Nómina Santander" 
                  required 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Tipo</label>
                  <select 
                    value={type} 
                    onChange={e => setType(e.target.value as any)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 font-medium outline-none text-slate-900 dark:text-slate-100"
                  >
                    <option value="Bank">Banco</option>
                    <option value="Cash">Efectivo</option>
                    <option value="Card">Tarjeta</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Saldo Inicial</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={balanceInput} 
                    onChange={e => setBalanceInput(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 font-bold outline-none text-slate-900 dark:text-slate-100" 
                    placeholder="0"
                    required 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Emoji</label>
                  <input 
                    type="text" 
                    value={emoji} 
                    onChange={e => setEmoji(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 text-center text-xl outline-none text-slate-900 dark:text-slate-100" 
                    placeholder="🏦"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Color</label>
                  <input 
                    type="color" 
                    value={color} 
                    onChange={e => setColor(e.target.value)}
                    className="w-full h-[60px] bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-2 outline-none cursor-pointer" 
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  type="button" 
                  onClick={() => { setIsAdding(false); setEditingAccount(null); }} 
                  className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-2xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="flex-1 py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 shadow-xl shadow-blue-100 dark:shadow-none transition-all active:scale-95"
                >
                  {editingAccount ? 'Guardar Cambios' : 'Crear Cuenta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isTransferring && (
        <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] w-full max-w-md p-10 shadow-2xl animate-in fade-in zoom-in duration-300 border border-transparent dark:border-slate-800">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100">Transferencia</h3>
              <button onClick={() => setIsTransferring(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full">
                <X size={20} className="text-slate-400" />
              </button>
            </div>
            
            <form onSubmit={handleTransfer} className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Desde</label>
                <select 
                  value={fromId} 
                  onChange={e => setFromId(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 font-medium outline-none text-slate-900 dark:text-slate-100"
                  required
                >
                  <option value="">Selecciona origen</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({getAccountHistoricalBalance(a.id, currentDate)}€)</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Hacia</label>
                <select 
                  value={toId} 
                  onChange={e => setToId(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 font-medium outline-none text-slate-900 dark:text-slate-100"
                  required
                >
                  <option value="">Selecciona destino</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({getAccountHistoricalBalance(a.id, currentDate)}€)</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Cantidad</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={transferAmount} 
                  onChange={e => setTransferAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 text-center text-3xl font-black outline-none text-slate-900 dark:text-white" 
                  placeholder="0"
                  required 
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button 
                  type="button" 
                  onClick={() => setIsTransferring(false)} 
                  className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-2xl hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="flex-1 py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 shadow-xl shadow-blue-100 dark:shadow-none transition-all"
                >
                  Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Accounts;
