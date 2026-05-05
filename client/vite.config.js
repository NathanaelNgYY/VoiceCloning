import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.PROXY_TARGET || 'http://localhost:3000';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          ws: true,
          timeout: 0,
          proxyTimeout: 0,
          configure: (proxy) => {
            proxy.on('error', (err, _req, res) => {
              console.warn('[proxy error]', err.message);
              if (res.writeHead && !res.headersSent) {
                res.writeHead(502);
              }
              res.end();
            });
          },
        },
        '/inference/progress': {
          target: proxyTarget,
          changeOrigin: true,
          timeout: 0,
          proxyTimeout: 0,
        },
        '/train/progress': {
          target: proxyTarget,
          changeOrigin: true,
          timeout: 0,
          proxyTimeout: 0,
        },
      },
    },
  };
});
