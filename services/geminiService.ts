import { AIChallenge } from "../types";
import { supabase } from "./supabase";

// Este módulo ya NO habla con Gemini: la clave vive solo en el servidor.
// Aquí únicamente se llama al proxy propio (/api/gemini) con la sesión del usuario.

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

export interface AdvisorResponse {
  text: string;
  functionCalls: { name: string; args: unknown }[];
}

async function callGemini<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Sesión no válida. Vuelve a iniciar sesión.');

  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action, payload }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error || 'No se ha podido completar la consulta.');
  }
  return await response.json() as T;
}

// Analiza una captura de pantalla o ticket extrayendo múltiples líneas y categorizando inteligentemente.
export const analyzeReceipt = (base64Image: string): Promise<ScannedTransaction[]> =>
  callGemini<ScannedTransaction[]>('analyzeReceipt', { image: base64Image });

/**
 * Genera retos financieros personalizados basados en el contexto presupuestario y patrimonial del usuario.
 */
export const generateAIChallenges = (context: string): Promise<AIChallenge[]> =>
  callGemini<AIChallenge[]>('generateChallenges', { context });

export const getFinancialAdviceWithTools = (
  context: string,
  userMessage: string,
  history: { role: string; text: string }[] = [],
): Promise<AdvisorResponse> =>
  callGemini<AdvisorResponse>('financialAdvice', { context, message: userMessage, history });
