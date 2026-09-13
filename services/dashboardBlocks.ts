// El orden de los bloques del dashboard esta guardado en el estado del usuario.
// Un usuario que ya tiene su layout guardado no contiene las claves de los
// bloques nuevos, asi que estos serian invisibles para siempre.
//
// La solucion NO es reescribir el layout guardado al arrancar: cualquier
// escritura en el montaje sube el documento entero a la nube. Se resuelve en
// lectura, fusionando el layout guardado con los bloques conocidos.

export const DASHBOARD_BLOCKS = [
  'balance',
  'report',
  'comparison',
  'savings',
  'evolution',
  'accounts',
  'budget',
];

/**
 * Bloques que ya no existen por separado. Se traducen en lectura, igual que el
 * resto de la fusion: los retos pasan a ser el informe de Aura, las dos graficas
 * de evolucion son ahora un solo bloque y "En que se va" vive dentro del bloque
 * de presupuestos (null = desaparece sin dejar hueco).
 */
export const LEGACY_ALIASES: Record<string, string | null> = {
  challenges: 'report',
  chart: 'evolution',
  trends: 'evolution',
  categories: null,
};

/**
 * Fusiona el layout guardado con los bloques conocidos:
 * - respeta el orden que el usuario haya elegido,
 * - traduce los bloques antiguos a su sustituto, en la posicion del primero,
 * - conserva claves que no conocemos (por si una version futura anade bloques),
 * - anade al final los bloques conocidos que falten,
 * - elimina duplicados,
 * - es idempotente.
 */
export function mergeLayout(
  saved: string[] | undefined | null,
  known: string[] = DASHBOARD_BLOCKS,
  aliases: Record<string, string | null> = LEGACY_ALIASES,
): string[] {
  const result: string[] = [];
  const seen: Record<string, boolean> = {};

  const push = (raw: unknown) => {
    if (typeof raw !== 'string' || !raw) return;
    const key = Object.prototype.hasOwnProperty.call(aliases, raw) ? aliases[raw] : raw;
    if (!key || seen[key]) return;
    seen[key] = true;
    result.push(key);
  };

  if (Array.isArray(saved)) for (let i = 0; i < saved.length; i++) push(saved[i]);
  for (let i = 0; i < known.length; i++) push(known[i]);

  return result;
}
