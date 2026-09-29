import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { request } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, SAMPLE_FILES } from './index.mjs';

let temporaryDirectory;
let distDirectory;
let sampleDirectory;
let server;
const workbook = Buffer.from('test workbook bytes');

function get(path, { method = 'GET', headers = {}, target = server } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1',
      port: target.address().port,
      method,
      path,
      headers: { Host: '192.168.0.15:8050', ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function listen(app) {
  await new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(0, '127.0.0.1', resolve);
  });
  return app;
}

async function close(app) {
  await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
}

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'dbprodazh-http-'));
  distDirectory = join(temporaryDirectory, 'dist');
  sampleDirectory = join(temporaryDirectory, 'data');
  await mkdir(join(distDirectory, 'assets'), { recursive: true });
  await mkdir(sampleDirectory);
  await Promise.all([
    writeFile(join(distDirectory, 'index.html'), '<!doctype html><main>Dashboard</main>'),
    writeFile(join(distDirectory, 'assets', 'app-123.js'), 'console.log("fixture");'),
    writeFile(join(distDirectory, 'assets', 'app-123.css'), 'body{color:#000}'),
    writeFile(join(distDirectory, '.env'), 'SECRET=must-not-be-served'),
    writeFile(join(temporaryDirectory, 'secret.json'), '{"secret":true}'),
    writeFile(join(sampleDirectory, SAMPLE_FILES[0]), workbook),
    writeFile(join(sampleDirectory, 'other.xlsx'), 'not allowlisted'),
  ]);
  server = await listen(createApp({ distDirectory, sampleDirectory, publicOrigin: 'http://192.168.0.15:8050' }));
});

after(async () => {
  if (server) await close(server);
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

test('health is JSON and works with loopback host for the container healthcheck', async () => {
  const result = await get('/health', { headers: { Host: '127.0.0.1:8050' } });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { status: 'ok' });
  assert.match(result.headers['content-type'], /application\/json/);
});

test('serves built HTML, JavaScript and CSS with correct MIME and asset caching', async () => {
  for (const [path, type] of [['/', 'text/html'], ['/assets/app-123.js', 'text/javascript'], ['/assets/app-123.css', 'text/css']]) {
    const result = await get(path);
    assert.equal(result.status, 200);
    assert.ok(result.headers['content-type'].startsWith(type));
    assert.equal(Number(result.headers['content-length']), result.body.length);
    if (path.startsWith('/assets/')) assert.match(result.headers['cache-control'], /immutable/);
  }
});

test('SPA routes return the shell while missing assets remain 404', async () => {
  const [index, route, missing] = await Promise.all([get('/'), get('/customers/detail'), get('/assets/missing.js')]);
  assert.equal(route.status, 200);
  assert.deepEqual(route.body, index.body);
  assert.equal(missing.status, 404);
});

test('manifest exposes only the five named sources and correct availability', async () => {
  const result = await get('/local-samples');
  assert.equal(result.status, 200);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(result.body), SAMPLE_FILES.map((name, i) => ({ name, url: `/local-samples/${i}`, available: i === 0 })));
});

test('allowlisted workbook is streamed unchanged with XLSX MIME', async () => {
  const result = await get('/local-samples/0');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, workbook);
  assert.equal(result.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});

test('HEAD returns metadata without a body for both assets and workbooks', async () => {
  for (const path of ['/', '/health', '/local-samples', '/local-samples/0']) {
    const result = await get(path, { method: 'HEAD' });
    assert.equal(result.status, 200);
    assert.equal(result.body.length, 0);
    assert.ok(Number(result.headers['content-length']) > 0);
  }
});

test('missing, malformed and unlisted sample paths cannot read files', async () => {
  for (const path of ['/local-samples/1', '/local-samples/5', '/local-samples/00', '/local-samples/-1', '/local-samples/other.xlsx', '/local-samples/0/extra']) {
    assert.equal((await get(path)).status, 404, path);
  }
});

test('sample endpoints accept the server LAN origin', async () => {
  const result = await get('/local-samples/0', { headers: { Origin: 'http://192.168.0.15:8050', 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(result.status, 200);
});

test('sample endpoints block foreign Origin and cross-site browser requests', async () => {
  for (const headers of [{ Origin: 'https://foreign.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await get('/local-samples', { headers })).status, 403);
    assert.equal((await get('/local-samples/0', { headers })).status, 403);
  }
});

test('unknown hosts cannot bypass same-origin checks through DNS rebinding', async () => {
  assert.equal((await get('/local-samples', { headers: { Host: 'foreign.example:8050', Origin: 'http://foreign.example:8050' } })).status, 403);
});

test('unsafe paths, dotfiles, sources and unknown extensions are not exposed', async () => {
  for (const path of ['/.env', '/.git/config', '/../secret.json', '/%2e%2e/secret.json', '/assets/%2e%2e/.env', '/src/App.tsx', '/vite.config.ts', '/package-lock.json']) {
    assert.equal((await get(path)).status, 404, path);
  }
  for (const path of ['/%00', '/%ZZ', '/assets%5c..%5csecret.json', '//foreign.example/']) {
    assert.equal((await get(path)).status, 400, path);
  }
});

test('write methods are rejected', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const result = await get('/local-samples/0', { method });
    assert.equal(result.status, 405);
    assert.equal(result.headers.allow, 'GET, HEAD');
  }
});

test('security headers allow local workers and exports but no cross-origin reads', async () => {
  for (const path of ['/', '/local-samples/0', '/missing.js']) {
    const result = await get(path);
    assert.equal(result.headers['x-content-type-options'], 'nosniff');
    assert.equal(result.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(result.headers['x-frame-options'], 'DENY');
    assert.equal(result.headers['access-control-allow-origin'], undefined);
    assert.match(result.headers['content-security-policy'], /worker-src 'self' blob:/);
    assert.match(result.headers['content-security-policy'], /connect-src 'self'/);
    assert.match(result.headers['content-security-policy'], /frame-ancestors 'none'/);
  }
});

test('empty data mount leaves application available for manual imports', async () => {
  const app = await listen(createApp({ distDirectory, sampleDirectory: join(temporaryDirectory, 'absent'), publicOrigin: '' }));
  try {
    const result = await get('/local-samples', { target: app });
    assert.equal(result.status, 200);
    assert.ok(JSON.parse(result.body).every((file) => file.available === false));
    assert.equal((await get('/', { target: app })).status, 200);
  } finally {
    await close(app);
  }
});
