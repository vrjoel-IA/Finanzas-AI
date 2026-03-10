
import { createClient } from '@supabase/supabase-js';

// Configuración de conexión con Supabase
// Estos valores permiten que la app guarde tus datos de forma segura en tu propio proyecto.

const supabaseUrl = 'https://obttpoybyvnwilndzdlj.supabase.co'; 
const supabaseAnonKey = 'sb_publishable_tfVPIvcp7VZe-eQN7Nt-dQ_iD4QQ5Ev'; // ¡Asegúrate de que tu clave real esté entre comillas!

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
