import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';

// Núcleo del proxy de Gemini. Se ejecuta SIEMPRE en servidor: ni la clave ni los
// prompts llegan nunca al navegador. Lo comparten la función de Netlify (producción)
// y el middleware de Vite (desarrollo), para que el comportamiento sea idéntico.

const env = (...names: string[]) => {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return '';
};

const MAX_IMAGE_CHARS = 8_000_000;   // ~6 MB de imagen en base64
const MAX_CONTEXT_CHARS = 120_000;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_HISTORY_TURNS = 20;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const fail = (status: number, message: string) => json({ error: message }, status);

// Solo se admiten usuarios con sesión válida: sin esto el endpoint sería una
// pasarela gratuita a Gemini para cualquiera que descubriese la URL.
async function verifiedUser(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization') || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const url = env('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');
  if (!url || !anonKey) throw new Error('Falta la configuración de Supabase en el servidor.');
  const response = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const user = await response.json() as { id?: string };
  return user?.id || null;
}

const readString = (value: unknown, max: number, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Falta el campo "${field}".`);
  if (value.length > max) throw new Error(`El campo "${field}" supera el tamaño permitido.`);
  return value;
};

const receiptSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      description: { type: Type.STRING },
      amount: { type: Type.NUMBER },
      date: { type: Type.STRING },
      category: { type: Type.STRING },
      type: { type: Type.STRING, enum: ['income', 'expense'] },
      isTransfer: { type: Type.BOOLEAN },
      isSaving: { type: Type.BOOLEAN },
      isRefund: { type: Type.BOOLEAN },
      suggestedAccount: { type: Type.STRING },
    },
    required: ['description', 'amount', 'date', 'category', 'type', 'isTransfer', 'isSaving', 'isRefund'],
  },
};

const challengeSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      title: { type: Type.STRING },
      target: { type: Type.NUMBER },
      type: { type: Type.STRING, enum: ['spending_limit', 'savings_goal', 'income_target'] },
      category: { type: Type.STRING },
      completed: { type: Type.BOOLEAN },
    },
    required: ['id', 'title', 'target', 'type', 'completed'],
  },
};

const functionDeclarations: FunctionDeclaration[] = [
  {
    name: 'createBudgetCategory',
    description: 'Crea una nueva categoría de presupuesto.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        categoryName: { type: Type.STRING },
        limit: { type: Type.NUMBER },
        type: { type: Type.STRING, enum: ['income', 'expense'] },
      },
      required: ['categoryName', 'limit', 'type'],
    },
  },
  {
    name: 'updateExistingBudgetLimit',
    description: 'Actualiza el límite de una categoría existente.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        categoryName: { type: Type.STRING },
        newLimit: { type: Type.NUMBER },
      },
      required: ['categoryName', 'newLimit'],
    },
  },
  {
    name: 'recordNewTransaction',
    description: 'Registra un nuevo ingreso o gasto manual.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        description: { type: Type.STRING },
        amount: { type: Type.NUMBER },
        category: { type: Type.STRING },
        type: { type: Type.STRING, enum: ['income', 'expense'] },
        accountName: { type: Type.STRING },
      },
      required: ['description', 'amount', 'category', 'type', 'accountName'],
    },
  },
];

const RECEIPT_PROMPT = `Analiza esta captura de pantalla de movimientos bancarios o ticket.
        
        INSTRUCCIONES VISUALES CRÍTICAS PARA IDENTIFICAR LA CUENTA:
        1. Si la imagen tiene FONDO BLANCO con partes o acentos VERDES, identifica la cuenta como "Banco Principal".
        2. Si la imagen tiene FONDO NEGRO o muy oscuro (Modo Oscuro), identifica la cuenta como "REVOLUT".
        
        INSTRUCCIONES DE CONTENIDO:
        - Extrae UNA LISTA de todas las transacciones visibles.
        - Para cada una, determina:
          1. description: nombre del comercio o concepto.
          2. amount: importe positivo.
          3. date: fecha YYYY-MM-DD (asume el año actual si no aparece).
          4. category: INTUYE la categoría más lógica basada en el nombre (ej: Restaurantes -> Ocio, Supermercado -> Alimentación, Gasolinera -> Transporte).
          5. type: 'income' para abonos, 'expense' para pagos.
          6. isTransfer: true si es entre tus cuentas.
          7. isSaving: true si va a una hucha/vault.
          8. isRefund: true si es un ingreso tipo Bizum de deuda.
          9. suggestedAccount: El nombre identificado según las reglas visuales anteriores ("Banco Principal" o "REVOLUT").`;

const ADVISOR_SYSTEM_INSTRUCTION = `Eres "Aura", una Asesora Financiera de Élite.
      Fusionas la alta gestión corporativa con las finanzas personales.
      Metodologías: Base Cero, Regla del 1/3, Método Kakebo.
      Responde siempre de forma estratégica y rigurosa.`;

type Payload = Record<string, unknown>;

// Cada acción define su propio prompt y su propio esquema. El cliente solo aporta
// datos, nunca instrucciones: así el endpoint no se puede reutilizar para otra cosa.
const actions: Record<string, (ai: GoogleGenAI, payload: Payload) => Promise<unknown>> = {
  async analyzeReceipt(ai, payload) {
    const image = readString(payload.image, MAX_IMAGE_CHARS, 'image');
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: image } }, { text: RECEIPT_PROMPT }] },
      config: { responseMimeType: 'application/json', responseSchema: receiptSchema },
    });
    return JSON.parse(response.text || '[]');
  },

  async generateChallenges(ai, payload) {
    const context = readString(payload.context, MAX_CONTEXT_CHARS, 'context');
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: `Actúa como Aura, asesora financiera experta. Basándote en el siguiente contexto financiero del usuario, genera 3 retos (AIChallenge) realistas y motivadores: ${context}`,
      config: { responseMimeType: 'application/json', responseSchema: challengeSchema },
    });
    return JSON.parse(response.text || '[]');
  },

  async financialAdvice(ai, payload) {
    const context = readString(payload.context, MAX_CONTEXT_CHARS, 'context');
    const message = readString(payload.message, MAX_MESSAGE_CHARS, 'message');
    // El historial es opcional: sin él cada consulta empieza de cero y Aura no
    // recuerda lo que se acaba de hablar.
    const rawHistory = Array.isArray(payload.history) ? payload.history.slice(-MAX_HISTORY_TURNS) : [];
    const history = rawHistory.flatMap((turn: unknown) => {
      if (!turn || typeof turn !== 'object') return [];
      const { role, text } = turn as { role?: unknown; text?: unknown };
      if (typeof text !== 'string' || !text.trim()) return [];
      if (role !== 'user' && role !== 'ai') return [];
      return [{ role: role === 'ai' ? 'model' : 'user', parts: [{ text: text.slice(0, MAX_MESSAGE_CHARS) }] }];
    });
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [...history, { role: 'user', parts: [{ text: `CONTEXTO FINANCIERO HISTÓRICO Y ACTUAL:\n${context}\n\nMENSAJE DEL USUARIO: ${message}` }] }],
      config: { systemInstruction: ADVISOR_SYSTEM_INSTRUCTION, tools: [{ functionDeclarations }] },
    });
    return {
      text: response.text || '',
      functionCalls: (response.functionCalls || []).map(call => ({ name: call.name, args: call.args })),
    };
  },
};

export async function handleGeminiRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') return fail(405, 'Método no permitido.');
  try {
    const apiKey = env('GEMINI_API_KEY');
    if (!apiKey) return fail(500, 'El servidor no tiene configurada la clave de Gemini.');

    const userId = await verifiedUser(request);
    if (!userId) return fail(401, 'Sesión no válida. Vuelve a iniciar sesión.');

    let body: Payload;
    try {
      body = await request.json() as Payload;
    } catch {
      return fail(400, 'Petición mal formada.');
    }

    const action = typeof body.action === 'string' ? actions[body.action] : undefined;
    if (!action) return fail(400, 'Acción no admitida.');

    const payload = (body.payload && typeof body.payload === 'object' ? body.payload : {}) as Payload;
    return json(await action(new GoogleGenAI({ apiKey }), payload));
  } catch (error) {
    // El detalle podría incluir datos de la petición a Gemini: se registra, no se devuelve.
    console.error('[gemini proxy]', error);
    const message = error instanceof Error && /campo|tamaño|configuración/.test(error.message)
      ? error.message
      : 'No se ha podido completar la consulta con Gemini.';
    return fail(502, message);
  }
}
