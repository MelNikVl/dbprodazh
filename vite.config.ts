import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';

// Only these explicit user-provided files are exposed, only on loopback.
const files = [
  '2024 год.xlsx',
  '2025 год.xlsx',
  '2026 год.xlsx',
  'план Август (4).xlsx',
  'план Сентябрь (6).xlsx',
];
const sampleDirectory = process.env.CRM_SAMPLE_DIR || 'J:/АН PRO';
function samples(): Plugin {
  const middleware = (req: any, res: any, next: () => void) => {
    if (!req.url?.startsWith('/local-samples')) return next();
    if (req.headers.origin && !/^http:\/\/(localhost|127\.0\.0\.1):8050$/.test(req.headers.origin)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/local-samples') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify(
          files.map((name, i) => ({
            name,
            url: `/local-samples/${i}`,
            available: existsSync(join(sampleDirectory, name)),
          })),
        ),
      );
      return;
    }
    const match = /^\/local-samples\/(\d+)$/.exec(req.url);
    const name = match ? files[Number(match[1])] : undefined;
    if (!name || !existsSync(join(sampleDirectory, name))) {
      res.statusCode = 404;
      res.end('Source file unavailable');
      return;
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const stream = createReadStream(join(sampleDirectory, name));
    stream.on('error', () => {
      res.statusCode = 500;
      res.end('Could not read source');
    });
    stream.pipe(res);
  };
  return {
    name: 'local-crm-samples',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
export default defineConfig({
  plugins: [react(), samples()],
  server: { host: '127.0.0.1', port: 8050, strictPort: true },
  preview: { host: '127.0.0.1', port: 8050, strictPort: true },
});
