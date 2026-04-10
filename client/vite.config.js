import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
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
        target: 'http://localhost:3000',
        changeOrigin: true,
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
    },
  },
});
