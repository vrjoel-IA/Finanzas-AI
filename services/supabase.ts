
import { createClient } from '@supabase/supabase-js';

// Configuración de conexión con Supabase
// Estos valores permiten que la app guarde tus datos de forma segura en tu propio proyecto.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
