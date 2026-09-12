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
    name: 'goToPeriod',
    description: 'Navega a un mes concreto de la aplicacion.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        month: { type: Type.STRING, description: 'Mes en formato AAAA-MM' },
      },
      required: ['month'],
    },
  },
  {
    name: 'setViewMode',
    description: 'Cambia entre la vista mensual y la anual.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        mode: { type: Type.STRING, description: 'month o year' },
      },
      required: ['mode'],
    },
  },
  {
    name: 'toggleTheme',
    description: 'Alterna entre tema claro y oscuro.',
    parameters: {
      type: Type.OBJECT,
      properties: {
      },
      required: [],
    },
  },
  {
    name: 'createBudgetCategory',
    description: 'Crea una nueva categoria de presupuesto en el mes seleccionado.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        categoryName: { type: Type.STRING, description: 'Nombre de la categoria' },
        limit: { type: Type.NUMBER, description: 'Limite en euros' },
        type: { type: Type.STRING, description: 'income o expense' },
      },
      required: ['categoryName', 'limit', 'type'],
    },
  },
  {
    name: 'updateExistingBudgetLimit',
    description: 'Cambia el limite de una categoria de presupuesto existente.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        categoryName: { type: Type.STRING, description: 'Categoria existente' },
        newLimit: { type: Type.NUMBER, description: 'Nuevo limite en euros' },
      },
      required: ['categoryName', 'newLimit'],
    },
  },
  {
    name: 'deleteBudgetCategory',
    description: 'Borra una categoria de presupuesto del mes seleccionado. No borra transacciones.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        categoryName: { type: Type.STRING, description: 'Categoria a borrar' },
      },
      required: ['categoryName'],
    },
  },
  {
    name: 'importBudgetsFromMonth',
    description: 'Copia los presupuestos de otro mes al mes seleccionado.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sourceMonth: { type: Type.STRING, description: 'Mes de origen en formato AAAA-MM' },
      },
      required: ['sourceMonth'],
    },
  },
  {
    name: 'recordNewTransaction',
    description: 'Registra un ingreso o gasto nuevo.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        description: { type: Type.STRING, description: 'Concepto' },
        amount: { type: Type.NUMBER, description: 'Importe positivo en euros' },
        category: { type: Type.STRING, description: 'Categoria' },
        type: { type: Type.STRING, description: 'income o expense' },
        accountName: { type: Type.STRING, description: 'Nombre exacto de la cuenta' },
        date: { type: Type.STRING, description: 'Fecha AAAA-MM-DD; si se omite se usa hoy' },
      },
      required: ['description', 'amount', 'category', 'type', 'accountName'],
    },
  },
  {
    name: 'updateExistingTransaction',
    description: 'Cambia el importe o la categoria de una transaccion existente, identificada por su descripcion exacta.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        description: { type: Type.STRING, description: 'Descripcion exacta de la transaccion' },
        newAmount: { type: Type.NUMBER, description: 'Nuevo importe' },
        newCategory: { type: Type.STRING, description: 'Nueva categoria' },
      },
      required: ['description'],
    },
  },
  {
    name: 'deleteExistingTransaction',
    description: 'Borra una transaccion existente, identificada por su descripcion exacta.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        description: { type: Type.STRING, description: 'Descripcion exacta de la transaccion' },
      },
      required: ['description'],
    },
  },
  {
    name: 'createSavingsGoal',
    description: 'Crea una hucha nueva con saldo inicial cero.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Nombre de la hucha' },
        targetAmount: { type: Type.NUMBER, description: 'Objetivo en euros, opcional' },
        isInvestment: { type: Type.BOOLEAN, description: 'true si es una inversion' },
      },
      required: ['name'],
    },
  },
  {
    name: 'updateSavingsGoal',
    description: 'Cambia el objetivo de una hucha. No toca el saldo acumulado.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Nombre de la hucha' },
        newTargetAmount: { type: Type.NUMBER, description: 'Nuevo objetivo en euros' },
      },
      required: ['name', 'newTargetAmount'],
    },
  },
  {
    name: 'deleteSavingsGoal',
    description: 'Borra una hucha que no tenga transacciones ligadas.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Nombre de la hucha' },
      },
      required: ['name'],
    },
  },
  {
    name: 'createAccount',
    description: 'Crea una cuenta nueva.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Nombre de la cuenta' },
        type: { type: Type.STRING, description: 'Bank, Cash o Card' },
        initialBalance: { type: Type.NUMBER, description: 'Saldo inicial en euros' },
      },
      required: ['name', 'type', 'initialBalance'],
    },
  },
  {
    name: 'renameAccount',
    description: 'Renombra una cuenta existente sin tocar su saldo ni sus transacciones.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        currentName: { type: Type.STRING, description: 'Nombre actual' },
        newName: { type: Type.STRING, description: 'Nombre nuevo' },
      },
      required: ['currentName', 'newName'],
    },
  },
  {
    name: 'markRefundAsSettled',
    description: 'Cierra un reembolso abierto dandolo por cobrado. No crea ninguna transaccion ni modifica saldos.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Nombre del reembolso' },
      },
      required: ['name'],
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

const ADVISOR_SYSTEM_INSTRUCTION = `Eres "Aura", la asistente financiera personal del usuario dentro de su propia aplicación de finanzas.

QUIÉN ERES
Fusionas la alta gestión corporativa con las finanzas personales. Conoces las metodologías
de Presupuesto Base Cero, la Regla del Tercio y el Método Kakebo. Hablas en español, de tú,
de forma directa y concreta. Nada de respuestas genéricas: el usuario te da sus datos reales
y espera respuestas sobre SUS números.

QUÉ VES
En cada mensaje recibes una foto completa de su situación: cuentas y saldos, huchas,
presupuestos del periodo con lo gastado, movimientos del periodo, reembolsos pendientes,
retos activos y la evolución de los últimos meses. Úsala. Cita cifras concretas.
Si algo no está en esa foto, dilo en vez de inventarlo.

QUÉ PUEDES HACER
Tienes herramientas para navegar por la app y para modificar los datos del usuario.
Úsalas cuando el usuario pida un cambio, no describas por escrito lo que podrías hacer.

Reglas al usarlas:
- Nunca ejecutas cambios directamente. Toda herramienta que modifica datos se convierte en
  una propuesta que el usuario debe confirmar con un botón. Así que propón con naturalidad,
  pero no afirmes que algo "ya está hecho": di que lo has propuesto y que lo confirme.
- Identifica cuentas, categorías, huchas y reembolsos por su nombre EXACTO tal y como
  aparece en el contexto. Si hay ambigüedad, pregunta en lugar de adivinar.
- Propón una sola acción por respuesta salvo que el usuario pida varias explícitamente.
  Al confirmar una propuesta las demás se descartan.
- Para borrar algo, asegúrate primero de que es lo que el usuario quiere.
- No registres transacciones que el usuario no haya pedido. Su historial es real y lo
  concilia con su banco.

LÍMITES
Vives dentro de la aplicación. No puedes mover dinero real, ni contactar con bancos, ni
pagar nada. Si te piden algo así, dilo con claridad y ofrece lo que sí puedes hacer.`;

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
