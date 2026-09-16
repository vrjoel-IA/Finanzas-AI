import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle, Sparkles, X } from 'lucide-react';
import { useFinance } from '../App';
import { analyzeReceipt } from '../services/geminiService';
import type { ScannedTransaction } from '../services/geminiService';
import TransactionModal from './TransactionModal';

// Aura Vision disponible desde cualquier pantalla. Antes el boton flotante
// navegaba a Transacciones con un aviso que nadie leia, y no se abria nada.
// Ahora abre directamente el selector del sistema (en el movil ofrece hacer la
// foto o elegirla) y la confirmacion aparece encima de la pantalla actual.
//
// Nada se guarda al analizar: los movimientos solo se crean cuando el usuario
// confirma cada uno en el formulario.

interface AuraVisionApi {
  /** Abre el selector de imagen. Llamar directamente desde un clic del usuario. */
  openPicker: () => void;
  isScanning: boolean;
}

const AuraVisionContext = createContext<AuraVisionApi | undefined>(undefined);

export const useAuraVision = (): AuraVisionApi => {
  const context = useContext(AuraVisionContext);
  if (!context) throw new Error('useAuraVision must be used within AuraVisionProvider');
  return context;
};

const readAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('No se ha podido leer la imagen.'));
    reader.readAsDataURL(file);
  });

export const AuraVisionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { startUndoBatch } = useFinance();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [queue, setQueue] = useState<ScannedTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // El navegador solo deja abrir el selector dentro del gesto del usuario, asi
  // que el click se lanza sincrono, sin await ni timeouts por medio.
  const openPicker = useCallback(() => {
    if (isScanning || !inputRef.current) return;
    setError(null);
    inputRef.current.click();
  }, [isScanning]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Se vacia para poder volver a elegir la misma foto si algo falla.
    e.target.value = '';
    if (!file) return;

    setIsScanning(true);
    setError(null);
    try {
      const base64 = await readAsBase64(file);
      const items = await analyzeReceipt(base64, file.type || undefined);
      // Se conserva el orden de la imagen: la tira de navegacion del modal
      // numera los movimientos como se ven en la captura. Antes se invertia para
      // imponer un orden de proceso, pero ahora se puede ir y volver entre los
      // pendientes, asi que ese orden ya no decide nada.
      const scanned = Array.isArray(items) ? items : [];
      if (scanned.length > 0) {
        // Iniciar batch de undo para toda la sesión de escaneo
        startUndoBatch();
        setQueue(scanned);
      } else {
        setError('Aura no ha encontrado movimientos en esa imagen.');
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error && err.message ? err.message : 'No se ha podido analizar la imagen.');
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <AuraVisionContext.Provider value={{ openPicker, isScanning }}>
      {children}
      <input type="file" ref={inputRef} className="hidden" accept="image/*" onChange={handleFileChange} />

      {isScanning && (
        <div className="fixed inset-0 bg-slate-900/90 z-[100] flex flex-col items-center justify-center p-6 text-center">
          <div className="relative mb-8">
            <div className="w-32 h-32 border-4 border-blue-500/20 rounded-full border-t-blue-500 animate-spin"></div>
            <Sparkles className="absolute inset-0 m-auto text-blue-500 animate-pulse" size={48} />
          </div>
          <h3 className="text-2xl font-black text-white mb-2">Aura Vision Procesando</h3>
          <p className="text-slate-400 max-w-xs">He recibido tu imagen. Estoy extrayendo y categorizando cada movimiento para ti...</p>
        </div>
      )}

      {error && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[90] w-[calc(100%-2rem)] max-w-md animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="flex items-start gap-3 bg-slate-900 dark:bg-slate-700 text-white px-5 py-4 rounded-2xl shadow-2xl border border-slate-700 dark:border-slate-600">
            <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
            <span className="text-sm font-bold flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-slate-400 hover:text-white" aria-label="Cerrar"><X size={16} /></button>
          </div>
        </div>
      )}

      {queue && (
        <TransactionModal editingTx={null} scannedItems={queue} onClose={() => setQueue(null)} />
      )}
    </AuraVisionContext.Provider>
  );
};
