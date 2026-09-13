// El orden de los bloques del dashboard esta guardado en el estado del usuario.
// Un usuario que ya tiene su layout guardado no contiene las claves de los
// bloques nuevos, asi que estos serian invisibles para siempre.
//
// La solucion NO es reescribir el layout guardado al arrancar: cualquier
// escritura en el montaje sube el documento entero a la nube. Se resuelve en
// lectura, fusionando el layout guardado con los bloques conocidos.

export const DASHBOARD_BLOCKS = [
  'balance',
  'comparison',
  'challenges',
  'savings',
  'chart',
  'trends',
  'categories',
  'accounts',
  'budget',
];

/**
 * Fusiona el layout guardado con los bloques conocidos:
 * - respeta el orden que el usuario haya elegido,
 * - conserva claves que no conocemos (por si una version futura anade bloques),
 * - anade al final los bloques conocidos que falten,
 * - elimina duplicados,
 * - es idempotente.
 */
export function mergeLayout(saved: string[] | undefined | null, known: string[] = DASHBOARD_BLOCKS): string[] {
  const result: string[] = [];
  const seen: Record<string, boolean> = {};

  const push = (key: unknown) => {
    if (typeof key !== 'string' || !key || seen[key]) return;
    seen[key] = true;
    result.push(key);
  };

  if (Array.isArray(saved)) for (let i = 0; i < saved.length; i++) push(saved[i]);
  for (let i = 0; i < known.length; i++) push(known[i]);

  return result;
}
