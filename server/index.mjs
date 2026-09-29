import { createServer as createHttpServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_FILES = Object.freeze([
  '2024 год.xlsx',
  '2025 год.xlsx',
  '2026 год.xlsx',
  'план Август (4).xlsx',
  'план Сентябрь (6).xlsx',
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

async function regularFile(path, root) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return undefined;
    const relativePath = relative(await realpath(root), await realpath(path));
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) return undefined;
    return info;
  } catch {
    return undefined;
  }
}

function end(req, res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', Buffer.byteLength(text));
  res.end(req.method === 'HEAD' ? undefined : text);
}

function sendFile(req, res, path, info, type) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', info.size);
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(path);
  stream.on('error', () => {
    if (res.headersSent) return res.destroy();
    end(req, res, 500, 'Could not read file');
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

export function createApp({
  distDirectory = resolve(fileURLToPath(new URL('../dist', import.meta.url))),
  sampleDirectory = process.env.CRM_SAMPLE_DIR || '/data',
  publicOrigin = process.env.PUBLIC_ORIGIN || '',
} = {}) {
  const publicUrl = publicOrigin ? new URL(publicOrigin) : undefined;
  if (publicUrl && (publicUrl.protocol !== 'http:' && publicUrl.protocol !== 'https:')) {
    throw new Error('PUBLIC_ORIGIN must be an http(s) origin');
  }
  const allowedHosts = publicUrl
    ? new Set([publicUrl.host, `127.0.0.1:${publicUrl.port || '8050'}`, `localhost:${publicUrl.port || '8050'}`])
    : undefined;

  return createHttpServer(async (req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return end(req, res, 405, 'Method not allowed');
      }
      const host = req.headers.host;
      if (!host || /[\s/@\\]/.test(host) || (allowedHosts && !allowedHosts.has(host))) {
        return end(req, res, 403, 'Host not allowed');
      }
      // Inspect the raw path before URL normalization can erase traversal segments.
      const rawPath = (req.url || '/').split('?')[0];
      let pathname;
      try {
        pathname = decodeURIComponent(rawPath);
      } catch {
        return end(req, res, 400, 'Invalid path');
      }
      if (!pathname.startsWith('/') || pathname.startsWith('//') || /[\\\u0000-\u001f]/.test(pathname)) {
        return end(req, res, 400, 'Invalid path');
      }
      if (pathname.split('/').some((part) => part.startsWith('.'))) {
        return end(req, res, 404, 'Not found');
      }
      if (pathname === '/health') {
        return end(req, res, 200, '{"status":"ok"}', 'application/json; charset=utf-8');
      }
      if (pathname === '/local-samples' || pathname.startsWith('/local-samples/')) {
        const origin = `${publicUrl?.protocol || 'http:'}//${host}`;
        if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
          return end(req, res, 403, 'Cross-origin access denied');
        }
        if (pathname === '/local-samples') {
          const files = await Promise.all(SAMPLE_FILES.map(async (name, index) => ({
            name,
            url: `/local-samples/${index}`,
            available: Boolean(await regularFile(resolve(sampleDirectory, name), sampleDirectory)),
          })));
          return end(req, res, 200, JSON.stringify(files), 'application/json; charset=utf-8');
        }
        const match = /^\/local-samples\/([0-4])$/.exec(pathname);
        const name = match ? SAMPLE_FILES[Number(match[1])] : undefined;
        const path = name ? resolve(sampleDirectory, name) : undefined;
        const info = path ? await regularFile(path, sampleDirectory) : undefined;
        if (!info) return end(req, res, 404, 'Source file unavailable');
        return sendFile(req, res, path, info, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      }

      // Only built assets are served: no application source, environment files, or arbitrary downloads.
      const extension = extname(pathname).toLowerCase();
      if (extension && !MIME[extension]) return end(req, res, 404, 'Not found');
      const path = resolve(distDirectory, `.${pathname === '/' ? '/index.html' : pathname}`);
      const info = await regularFile(path, distDirectory);
      if (info) {
        res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
        return sendFile(req, res, path, info, MIME[extension || '.html']);
      }
      // Missing assets stay 404; only extensionless client routes use the SPA shell.
      if (extension || pathname.startsWith('/assets/')) return end(req, res, 404, 'Not found');
      const indexPath = resolve(distDirectory, 'index.html');
      const indexInfo = await regularFile(indexPath, distDirectory);
      if (!indexInfo) return end(req, res, 503, 'Application build unavailable');
      return sendFile(req, res, indexPath, indexInfo, MIME['.html']);
    } catch {
      if (res.headersSent) return res.destroy();
      return end(req, res, 500, 'Internal server error');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '0.0.0.0';
  const port = Number(process.env.PORT || 8050);
  const server = createApp();
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.listen(port, host, () => console.log(`Sales dashboard listening on ${host}:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}
