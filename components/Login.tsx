import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { Mail, Lock, Sparkles, Loader2, ArrowRight, Wallet, UserPlus, LogIn, Smartphone, Laptop, Globe, CheckSquare, Square } from 'lucide-react';

interface LoginProps {
  onGuestLogin: () => void;
}

const Login: React.FC<LoginProps> = ({ onGuestLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    try {
      if (isRegistering) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        setMessage({ type: 'success', text: '¡Cuenta creada con éxito! Ya puedes iniciar sesión.' });
        setIsRegistering(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        // La sesión se actualizará automáticamente en App.tsx via onAuthStateChange
      }
    } catch (error: any) {
      console.error("Login error:", error);
      setMessage({ type: 'error', text: error.message || 'Ocurrió un error en la autenticación' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-[3.5rem] p-8 md:p-14 shadow-2xl border border-slate-100 dark:border-slate-800 text-center animate-in fade-in zoom-in duration-500">
        <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center text-white mx-auto mb-8 shadow-xl shadow-blue-200 dark:shadow-none">
          <Wallet size={40} />
        </div>
        
        <h1 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">
          Estrategia <span className="text-blue-600">Pro</span>
        </h1>
        <p className="text-slate-500 dark:text-slate-400 font-medium mb-10">
          {isRegistering ? 'Crea tu cuenta permanente' : 'Inicia sesión para sincronizar tus dispositivos'}
        </p>

        <div className="grid grid-cols-3 gap-4 mb-10">
          <div className="flex flex-col items-center gap-2 opacity-60">
            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-2xl"><Smartphone size={20} className="text-slate-600 dark:text-slate-400" /></div>
            <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Móvil</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="p-3 bg-blue-50 dark:bg-blue-900/40 rounded-2xl border border-blue-100 dark:border-blue-800"><Globe size={20} className="text-blue-600 dark:text-blue-400" /></div>
            <span className="text-[8px] font-black uppercase tracking-widest text-blue-600">Sincronizado</span>
          </div>
          <div className="flex flex-col items-center gap-2 opacity-60">
            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-2xl"><Laptop size={20} className="text-slate-600 dark:text-slate-400" /></div>
            <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">PC / Tablet</span>
          </div>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div className="relative">
            <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input 
              type="email" 
              placeholder="Email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 pl-14 pr-5 font-bold outline-none focus:border-blue-500 transition-all dark:text-white"
              required
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input 
              type="password" 
              placeholder="Contraseña" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 pl-14 pr-5 font-bold outline-none focus:border-blue-500 transition-all dark:text-white"
              required
              minLength={6}
            />
          </div>

          <button 
            type="submit" 
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-5 rounded-2xl flex items-center justify-center gap-3 transition-all shadow-xl shadow-blue-100 dark:shadow-none active:scale-95 disabled:opacity-50 text-lg"
          >
            {isLoading ? (
              <Loader2 size={24} className="animate-spin" />
            ) : (
              isRegistering ? <><UserPlus size={20} /> REGISTRARSE</> : <><LogIn size={20} /> ENTRAR AHORA</>
            )}
          </button>
        </form>

        <div className="mt-6 flex flex-col gap-4">
          <button 
            onClick={() => { setIsRegistering(!isRegistering); setMessage(null); }}
            className="text-sm font-black text-blue-600 dark:text-blue-400 hover:underline underline-offset-4"
          >
            {isRegistering ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate aquí'}
          </button>
          
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100 dark:border-slate-800"></div></div>
            <div className="relative flex justify-center text-[10px] uppercase font-black tracking-widest text-slate-400 dark:text-slate-600"><span className="bg-white dark:bg-slate-900 px-6">O simplemente prueba</span></div>
          </div>

          <button 
            onClick={onGuestLogin}
            className="w-full bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all border border-slate-100 dark:border-slate-700 active:scale-95 text-xs"
          >
            Modo Local (Sin registro)
          </button>
        </div>

        {message && (
          <div className={`mt-8 p-6 rounded-2xl text-sm font-bold animate-in slide-in-from-top-4 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
            <p>{message.text}</p>
          </div>
        )}

        <p className="mt-10 text-[10px] text-slate-400 font-black uppercase tracking-widest flex items-center justify-center gap-2">
          <Sparkles size={12} /> Datos cifrados y sincronizados
        </p>
      </div>
    </div>
  );
};

export default Login;