import http from 'node:http';
import { config, assertConfigured } from './config.js';
import { checkAndCount, stats } from './limits.js';
import { buildUpstreamPayload, deviceIdFrom } from './validate.js';

/**
 * Proxy AI pentru Dosar.
 *
 * Expune un singur endpoint compatibil OpenAI, ca aplicația să-l poată folosi
 * schimbând doar URL-ul de bază: POST /v1/chat/completions.
 *
 * PRINCIPIU DE CONFIDENȚIALITATE: nu logăm NICIODATĂ prompturi, mesaje sau
 * răspunsuri. Prin serviciul ăsta trec date personale și medicale ale
 * utilizatorilor. Logurile conțin doar status, model și durată.
 * Vezi .claude/rules/ai-privacy.md.
 */

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** Format de eroare compatibil OpenAI — aplicația citește deja response.text(). */
const errorBody = message => ({ error: { message, type: 'proxy_error' } });

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('Cerere prea mare.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleCompletions(req, res) {
  if (config.appToken) {
    // Acceptăm token-ul în oricare din două forme. `Authorization: Bearer` e
    // acolo ca aplicația să nu trebuiască să schimbe nimic în felul în care
    // construiește cererea: `aiProvider.ts` și testul de conexiune din Setări
    // trimit deja exact acel header către orice provider compatibil OpenAI.
    const auth = req.headers.authorization;
    const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const supplied = req.headers['x-dosar-key'] || bearer;
    if (supplied !== config.appToken) {
      // Doar NUMELE header-elor primite — niciodată valorile. Ajută la
      // diagnosticarea cazului în care platforma filtrează un header.
      console.log(`[auth] respins; headere primite: ${Object.keys(req.headers).join(',')}`);
      return send(res, 401, errorBody('Neautorizat.'));
    }
  }

  let raw;
  try {
    raw = await readBody(req, config.maxBodyBytes);
  } catch (e) {
    const status = e && e.status === 413 ? 413 : 400;
    return send(res, status, errorBody(status === 413 ? 'Cerere prea mare.' : 'Corp invalid.'));
  }

  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return send(res, 400, errorBody('JSON invalid.'));
  }

  const built = buildUpstreamPayload(body, config);
  if (!built.ok) return send(res, built.status, errorBody(built.message));

  const gate = checkAndCount(deviceIdFrom(req), config);
  if (!gate.ok) {
    // 429 e statusul pe care aplicația îl tratează deja ca „limită atinsă" și
    // pentru care afișează AI_UNLIMITED_HINT (model local / cheie proprie).
    return send(
      res,
      429,
      errorBody(
        gate.scope === 'device'
          ? `Ai atins limita de ${config.perDeviceDailyLimit} interogări pe zi.`
          : 'Serviciul a atins plafonul zilnic. Încearcă mâine.'
      )
    );
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.upstreamTimeoutMs);

  try {
    const upstream = await fetch(`${config.upstreamUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(built.payload),
      signal: controller.signal,
    });

    const text = await upstream.text();
    console.log(
      `[ai] model=${built.payload.model} status=${upstream.status} ms=${Date.now() - started}`
    );
    res.writeHead(upstream.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(text);
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    console.log(`[ai] model=${built.payload.model} status=err ms=${Date.now() - started}`);
    send(
      res,
      aborted ? 504 : 502,
      errorBody(aborted ? 'Providerul AI nu a răspuns la timp.' : 'Providerul AI nu e disponibil.')
    );
  } finally {
    clearTimeout(timer);
  }
}

export const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && (url === '/health' || url === '/')) {
    return send(res, 200, { ok: true, ...stats() });
  }
  if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/chat/completions')) {
    return void handleCompletions(req, res);
  }
  send(res, 404, errorBody('Endpoint inexistent.'));
});

if (process.env.NODE_ENV !== 'test') {
  assertConfigured();
  server.listen(config.port, () => {
    console.log(`[ai] proxy pornit pe :${config.port}`);
  });
}
