import { handleGeminiRequest } from './gemini-core.mts';

// Netlify Functions v2: recibe una Request estándar y devuelve una Response.
export default async (request: Request): Promise<Response> => handleGeminiRequest(request);

export const config = { path: '/api/gemini' };
