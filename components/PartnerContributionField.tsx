import React from 'react';
import { Users } from 'lucide-react';

// Aportacion de la otra persona al traspasar a una cuenta compartida. Se apunta
// en el mismo paso que la tuya para no tener que registrarla aparte. Vacio = no
// aporta nada esta vez.

interface Props {
  value: number | '';
  myAmount: number | '';
  onChange: (value: number | '') => void;
}

const PartnerContributionField: React.FC<Props> = ({ value, myAmount, onChange }) => (
  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-900/40">
    <label className="flex items-center gap-2 text-[11px] font-black text-blue-700 dark:text-blue-300 uppercase tracking-widest mb-3">
      <Users size={14} /> Aporta la otra persona
    </label>
    <div className="flex gap-2">
      <input
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className="flex-1 min-w-0 bg-white dark:bg-slate-800 border border-blue-100 dark:border-slate-700 rounded-xl p-3 font-bold outline-none text-slate-900 dark:text-white"
        placeholder="0 (nada)"
      />
      {myAmount !== '' && Number(myAmount) > 0 && (
        <button
          type="button"
          onClick={() => onChange(Number(myAmount))}
          className="px-3 bg-white dark:bg-slate-800 border border-blue-100 dark:border-slate-700 rounded-xl text-[11px] font-black text-blue-700 dark:text-blue-300 uppercase tracking-widest whitespace-nowrap"
        >
          Lo mismo
        </button>
      )}
    </div>
    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
      Se apunta como un ingreso aparte en la cuenta compartida. Suma al saldo, pero no a tu parte ni a tus ingresos.
    </p>
  </div>
);

export default PartnerContributionField;
