import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// En desarrollo no hay Netlify delante, así que montamos aquí la MISMA función
// servidor. La clave de Gemini se queda en este proceso y nunca se expone al cliente.
function geminiProxyPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'gemini-proxy-dev',
    apply: 'serve',
    configureServer(server) {
      for (const name of ['GEMINI_API_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
        if (!process.env[name] && env[name]) process.env[name] = env[name];
      }
      server.middlewares.use('/api/gemini', async (req, res) => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const { handleGeminiRequest } = await server.ssrLoadModule('/netlify/functions/gemini-core.mts');
          const response: Response = await handleGeminiRequest(new Request('http://localhost/api/gemini', {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          }));
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          console.error('[gemini proxy dev]', error);
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'Fallo del proxy de Gemini en desarrollo.' }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), geminiProxyPlugin(env)],
      // GEMINI_API_KEY ya NO se inyecta aquí: vivía en el bundle del navegador.
      // Solo se exponen al cliente los valores públicos de Supabase.
      define: {
        'process.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || ''),
        'process.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
