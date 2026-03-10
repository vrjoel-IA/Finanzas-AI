
import { GoogleGenAI, Type, FunctionDeclaration, GenerateContentResponse } from "@google/genai";
import { Transaction, Budget, AIChallenge } from "../types";

export interface ScannedTransaction {
  description: string;
  amount: number;
  date: string;
  category: string;
  type: 'income' | 'expense';
  isTransfer: boolean;
  isSaving: boolean;
  isRefund: boolean;
  suggestedAccount?: string;
}

// Analiza una captura de pantalla o ticket extrayendo múltiples líneas y categorizando inteligentemente.
export const analyzeReceipt = async (base64Image: string): Promise<ScannedTransaction[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
        { text: `Analiza esta captura de pantalla de movimientos bancarios o ticket.
        
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
          9. suggestedAccount: El nombre identificado según las reglas visuales anteriores ("Banco Principal" o "REVOLUT").` }
      ]
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
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
            suggestedAccount: { type: Type.STRING }
          },
          required: ['description', 'amount', 'date', 'category', 'type', 'isTransfer', 'isSaving', 'isRefund']
        }
      }
    }
  });
  return JSON.parse(response.text || "[]");
};

/**
 * Genera retos financieros personalizados basados en el contexto presupuestario y patrimonial del usuario.
 */
export const generateAIChallenges = async (context: string): Promise<AIChallenge[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `Actúa como Aura, asesora financiera experta. Basándote en el siguiente contexto financiero del usuario, genera 3 retos (AIChallenge) realistas y motivadores: ${context}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            title: { type: Type.STRING },
            target: { type: Type.NUMBER },
            type: { 
              type: Type.STRING, 
              enum: ['spending_limit', 'savings_goal', 'income_target']
            },
            category: { type: Type.STRING },
            completed: { type: Type.BOOLEAN }
          },
          required: ['id', 'title', 'target', 'type', 'completed']
        }
      }
    }
  });
  return JSON.parse(response.text || "[]");
};

export const tools: { functionDeclarations: FunctionDeclaration[] }[] = [{
  functionDeclarations: [
    {
      name: 'createBudgetCategory',
      description: 'Crea una nueva categoría de presupuesto.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          categoryName: { type: Type.STRING },
          limit: { type: Type.NUMBER },
          type: { type: Type.STRING, enum: ['income', 'expense'] }
        },
        required: ['categoryName', 'limit', 'type']
      }
    },
    {
      name: 'updateExistingBudgetLimit',
      description: 'Actualiza el límite de una categoría existente.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          categoryName: { type: Type.STRING },
          newLimit: { type: Type.NUMBER }
        },
        required: ['categoryName', 'newLimit']
      }
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
          accountName: { type: Type.STRING }
        },
        required: ['description', 'amount', 'category', 'type', 'accountName']
      }
    }
  ]
}];

export const getFinancialAdviceWithTools = async (
  context: string,
  userMessage: string
): Promise<GenerateContentResponse> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  return await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `CONTEXTO FINANCIERO HISTÓRICO Y ACTUAL:\n${context}\n\nMENSAJE DEL USUARIO: ${userMessage}`,
    config: {
      systemInstruction: `Eres "Aura", una Asesora Financiera de Élite.
      Fusionas la alta gestión corporativa con las finanzas personales.
      Metodologías: Base Cero, Regla del 1/3, Método Kakebo.
      Responde siempre de forma estratégica y rigurosa.`,
      tools: tools
    }
  });
};
