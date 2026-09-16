import React, { useMemo, useState } from 'react';
import { useFinance } from '../App';
import { X, Trash2, Pencil, Plus, CalendarClock } from 'lucide-react';
import type { ExpenseReminder, ReminderSchedule } from '../types';
import { occursIn } from '../services/expenseReminders';

// Alta, edicion y gestion de los recordatorios de gastos.
//
// Ni pantalla propia ni pestana dentro de Presupuestos: un modal que se abre
// desde el bloque del dashboard. En Presupuestos todo limita y se compara con lo
// gastado, y poner los recordatorios al lado de las tarjetas de limite diria
// justo lo que un recordatorio NO es.

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

interface ReminderModalProps {
  /** Mes en pantalla ('YYYY-MM'), para rellenar el arranque del recordatorio. */
  month: string;
  /** Recordatorio a editar, 'nuevo' para crear, o null para la lista. */
  initial: ExpenseReminder | 'nuevo' | null;
  onClose: () => void;
}

const nuevoId = () => 'rem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

const ReminderModal: React.FC<ReminderModalProps> = ({ month, initial, onClose }) => {
  const { expenseReminders, budgets, accounts, saveReminder, deleteReminder } = useFinance();
  const lista = expenseReminders || [];

  const [editando, setEditando] = useState<ExpenseReminder | null>(
    initial === 'nuevo' ? null : (initial || null),
  );
  const [modo, setModo] = useState<'lista' | 'form'>(initial ? 'form' : 'lista');
  const [confirmandoBorrado, setConfirmandoBorrado] = useState<string | null>(null);

  const categoriasGasto = useMemo(
    () => Array.from(new Set(budgets.filter(b => b.type === 'expense').map(b => b.category))),
    [budgets],
  );

  const mesValido = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);

  // Formulario
  const [nombre, setNombre] = useState(editando ? editando.name : '');
  const [emoji, setEmoji] = useState(editando && editando.emoji ? editando.emoji : '🔔');
  const [importe, setImporte] = useState<number | ''>(editando && editando.amount !== undefined ? editando.amount : '');
  const [categoria, setCategoria] = useState(editando && editando.category ? editando.category : (categoriasGasto[0] || ''));
  const [cuenta, setCuenta] = useState(editando && editando.accountId ? editando.accountId : '');
  const [cadencia, setCadencia] = useState<ReminderSchedule['kind']>(editando ? editando.schedule.kind : 'monthly');
  const [dia, setDia] = useState<number | ''>(() => {
    if (!editando) return '';
    const schedule = editando.schedule as any;
    if (schedule.kind === 'once') return Number(String(schedule.date || '').slice(8, 10)) || '';
    return schedule.day === undefined ? '' : schedule.day;
  });
  const [mesAncla, setMesAncla] = useState<number>(() => {
    if (!editando) return Number(mesValido.slice(5, 7));
    const schedule = editando.schedule as any;
    if (schedule.kind === 'annual') return Number(schedule.month) || 1;
    if (schedule.kind === 'quarterly') return Number(schedule.anchorMonth) || 1;
    if (schedule.kind === 'once') return Number(String(schedule.date || '').slice(5, 7)) || 1;
    return Number(mesValido.slice(5, 7));
  });
  const [anioPuntual, setAnioPuntual] = useState<number>(() => {
    if (editando && editando.schedule.kind === 'once') return Number(String((editando.schedule as any).date || '').slice(0, 4)) || Number(mesValido.slice(0, 4));
    return Number(mesValido.slice(0, 4));
  });
  const [notas, setNotas] = useState(editando && editando.notes ? editando.notes : '');

  const abrirNuevo = () => {
    setEditando(null);
    setNombre(''); setEmoji('🔔'); setImporte(''); setCategoria(categoriasGasto[0] || '');
    setCuenta(''); setCadencia('monthly'); setDia(''); setMesAncla(Number(mesValido.slice(5, 7)));
    setAnioPuntual(Number(mesValido.slice(0, 4))); setNotas('');
    setModo('form');
  };

  const abrirEdicion = (reminder: ExpenseReminder) => {
    setEditando(reminder);
    setNombre(reminder.name);
    setEmoji(reminder.emoji || '🔔');
    setImporte(reminder.amount === undefined ? '' : reminder.amount);
    setCategoria(reminder.category || categoriasGasto[0] || '');
    setCuenta(reminder.accountId || '');
    setCadencia(reminder.schedule.kind);
    const schedule = reminder.schedule as any;
    setDia(schedule.kind === 'once' ? (Number(String(schedule.date || '').slice(8, 10)) || '') : (schedule.day === undefined ? '' : schedule.day));
    setMesAncla(
      schedule.kind === 'annual' ? Number(schedule.month) || 1
        : schedule.kind === 'quarterly' ? Number(schedule.anchorMonth) || 1
        : schedule.kind === 'once' ? Number(String(schedule.date || '').slice(5, 7)) || 1
        : Number(mesValido.slice(5, 7)),
    );
    setAnioPuntual(schedule.kind === 'once' ? (Number(String(schedule.date || '').slice(0, 4)) || Number(mesValido.slice(0, 4))) : Number(mesValido.slice(0, 4)));
    setNotas(reminder.notes || '');
    setModo('form');
  };

  const construirSchedule = (): ReminderSchedule => {
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
    const diaNum = dia === '' ? undefined : Number(dia);
    if (cadencia === 'monthly') return { kind: 'monthly', day: diaNum };
    if (cadencia === 'quarterly') return { kind: 'quarterly', anchorMonth: mesAncla, day: diaNum };
    if (cadencia === 'annual') return { kind: 'annual', month: mesAncla, day: diaNum };
    return { kind: 'once', date: anioPuntual + '-' + pad(mesAncla) + '-' + pad(diaNum || 1) };
  };

  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) return;
    // Lo ya cumplido, saltado o rechazado se conserva al editar: es historico del
    // usuario y no tiene por que perderse al cambiarle el importe.
    const reminder: ExpenseReminder = {
      id: editando ? editando.id : nuevoId(),
      name: nombre.trim(),
      amount: importe === '' ? undefined : Number(importe),
      category: categoria || undefined,
      schedule: construirSchedule(),
      startMonth: editando ? editando.startMonth : mesValido,
      endMonth: editando ? editando.endMonth : undefined,
      accountId: cuenta || undefined,
      emoji: emoji || '🔔',
      notes: notas || undefined,
      done: editando ? editando.done : undefined,
      skipped: editando ? editando.skipped : undefined,
      rejected: editando ? editando.rejected : undefined,
      archived: editando ? editando.archived : undefined,
    };
    saveReminder(reminder);
    if (initial) onClose();
    else setModo('lista');
  };

  const borrar = (id: string) => {
    if (confirmandoBorrado !== id) {
      setConfirmandoBorrado(id);
      window.setTimeout(() => setConfirmandoBorrado(actual => (actual === id ? null : actual)), 4000);
      return;
    }
    setConfirmandoBorrado(null);
    deleteReminder(id);
  };

  const describir = (reminder: ExpenseReminder): string => {
    const schedule = reminder.schedule as any;
    const dias = schedule.day ? ', día ' + schedule.day : '';
    if (schedule.kind === 'monthly') return 'Cada mes' + dias;
    if (schedule.kind === 'quarterly') return 'Cada 3 meses desde ' + MESES[(Number(schedule.anchorMonth) || 1) - 1] + dias;
    if (schedule.kind === 'annual') return 'Cada año en ' + MESES[(Number(schedule.month) || 1) - 1] + dias;
    return 'Solo el ' + String(schedule.date || '');
  };

  const etiquetaCadencia = (kind: ReminderSchedule['kind']) =>
    kind === 'monthly' ? 'Mensual' : kind === 'quarterly' ? 'Trimestral' : kind === 'annual' ? 'Anual' : 'Un solo día';

  const pill = (activo: boolean) =>
    `px-4 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${
      activo ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
    }`;

  const label = 'block text-[11px] font-black text-slate-700 dark:text-slate-400 uppercase tracking-widest mb-3';
  const input = 'w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl p-4 font-bold outline-none focus:border-blue-400 dark:focus:border-blue-600 transition-all text-slate-900 dark:text-white';

  return (
    <div className="fixed inset-0 bg-slate-900/90 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-[3rem] w-full max-w-lg p-8 md:p-10 shadow-2xl animate-in zoom-in duration-300 border border-slate-200 dark:border-slate-800 overflow-y-auto max-h-[90vh] custom-scrollbar">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {modo === 'lista' ? 'Tus recordatorios' : editando ? 'Editar recordatorio' : 'Nuevo recordatorio'}
            </h3>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 leading-relaxed max-w-sm">
              Solo avisan. No crean ningún movimiento ni se restan de tus presupuestos.
            </p>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 shrink-0"><X size={24} /></button>
        </div>

        {modo === 'lista' ? (
          <div className="space-y-3">
            {lista.length === 0 && (
              <div className="text-center py-10">
                <CalendarClock size={32} className="mx-auto text-slate-300 dark:text-slate-700 mb-3" />
                <p className="text-sm text-slate-400 dark:text-slate-500 leading-relaxed">
                  Aún no tienes recordatorios. Añade el seguro, el gimnasio o esa cuota que siempre te pilla.
                </p>
              </div>
            )}
            {lista.map(reminder => (
              <div key={reminder.id} className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800">
                <span className="text-xl shrink-0">{reminder.emoji || '🔔'}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-sm text-slate-800 dark:text-slate-100 truncate">{reminder.name}</p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500">
                    {describir(reminder)}
                    {reminder.amount !== undefined && ' · ' + reminder.amount.toLocaleString('es-ES') + '€'}
                    {!occursIn(reminder, mesValido) && ' · este mes no toca'}
                  </p>
                </div>
                <button onClick={() => abrirEdicion(reminder)} className="p-2.5 rounded-xl text-slate-400 hover:bg-white dark:hover:bg-slate-700 hover:text-blue-600 transition-colors shrink-0"><Pencil size={16} /></button>
                <button
                  onClick={() => borrar(reminder.id)}
                  className={`p-2.5 rounded-xl transition-colors shrink-0 ${confirmandoBorrado === reminder.id ? 'bg-rose-600 text-white' : 'text-slate-400 hover:bg-white dark:hover:bg-slate-700 hover:text-rose-600'}`}
                  title={confirmandoBorrado === reminder.id ? 'Pulsa otra vez para borrar' : 'Borrar'}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button
              onClick={abrirNuevo}
              className="w-full flex items-center justify-center gap-2 py-4 mt-4 bg-blue-600 text-white font-black rounded-2xl text-[11px] uppercase tracking-widest transition-all active:scale-95"
            >
              <Plus size={16} /> Nuevo recordatorio
            </button>
          </div>
        ) : (
          <form onSubmit={guardar} className="space-y-6">
            <div className="flex gap-3">
              <div className="w-20 shrink-0">
                <label className={label}>Icono</label>
                <input type="text" value={emoji} onChange={e => setEmoji(e.target.value.slice(0, 2))} className={input + ' text-center text-xl'} />
              </div>
              <div className="flex-1 min-w-0">
                <label className={label}>Nombre</label>
                <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} className={input} placeholder="Seguro del coche" required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={label}>Importe (€)</label>
                <input type="number" step="0.01" value={importe} onChange={e => setImporte(e.target.value === '' ? '' : Number(e.target.value))} className={input} placeholder="Si lo sabes" />
              </div>
              <div>
                <label className={label}>Categoría</label>
                <select value={categoria} onChange={e => setCategoria(e.target.value)} className={input}>
                  <option value="">Sin categoría</option>
                  {categoriasGasto.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className={label}>Cada cuánto</label>
              <div className="flex flex-wrap gap-2">
                {(['monthly', 'quarterly', 'annual', 'once'] as ReminderSchedule['kind'][]).map(kind => (
                  <button key={kind} type="button" onClick={() => setCadencia(kind)} className={pill(cadencia === kind)}>
                    {etiquetaCadencia(kind)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {(cadencia === 'quarterly' || cadencia === 'annual' || cadencia === 'once') && (
                <div>
                  <label className={label}>{cadencia === 'quarterly' ? 'Empieza en' : 'Mes'}</label>
                  <select value={mesAncla} onChange={e => setMesAncla(Number(e.target.value))} className={input}>
                    {MESES.map((nombreMes, i) => <option key={nombreMes} value={i + 1}>{nombreMes}</option>)}
                  </select>
                </div>
              )}
              {cadencia === 'once' && (
                <div>
                  <label className={label}>Año</label>
                  <input type="number" value={anioPuntual} onChange={e => setAnioPuntual(Number(e.target.value))} className={input} />
                </div>
              )}
              <div>
                <label className={label}>Día del mes</label>
                <input type="number" min={1} max={31} value={dia} onChange={e => setDia(e.target.value === '' ? '' : Number(e.target.value))} className={input} placeholder="Opcional" />
              </div>
              {accounts.length > 0 && cadencia !== 'once' && (
                <div>
                  <label className={label}>Cuenta</label>
                  <select value={cuenta} onChange={e => setCuenta(e.target.value)} className={input}>
                    <option value="">Cualquiera</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className={label}>Notas</label>
              <input type="text" value={notas} onChange={e => setNotas(e.target.value)} className={input} placeholder="Opcional" />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => (initial ? onClose() : setModo('lista'))}
                className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400 font-black rounded-2xl text-[11px] uppercase tracking-widest"
              >
                {initial ? 'Cancelar' : 'Volver'}
              </button>
              <button type="submit" className="flex-1 py-4 bg-blue-600 text-white font-black rounded-2xl text-[11px] uppercase tracking-widest transition-all active:scale-95">
                Guardar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ReminderModal;
