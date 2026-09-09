import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.MISTRAL_API_KEY = 'test-key';
process.env.PROXY_APP_TOKEN = 'app-token';
process.env.PER_DEVICE_DAILY_LIMIT = '2';
process.env.GLOBAL_DAILY_LIMIT = '3';
process.env.MAX_TOKENS_CAP = '1000';
process.env.UPSTREAM_REASONING_EFFORT = 'none';
// Providerul din spate e Gemini: aplicatia trimite nume Mistral, proxy-ul traduce.
process.env.MODEL_MAP = JSON.stringify({
  'mistral-small-latest': 'gemini-3.8-flash',
  'mistral-large-latest': 'gemini-3.8-flash',
  'pixtral-large-latest': 'gemini-3.8-flash',
});

let upstream;
let upstreamCalls = [];
let upstreamStatus = 200;
let proxy;
let base;

before(async () => {
  // Fals „Mistral": înregistrează ce a primit și răspunde OK.
  upstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      upstreamCalls.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
      if (upstreamStatus !== 200) {
        res.writeHead(upstreamStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Unauthorized' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'salut' } }] }));
    });
  });
  await new Promise(r => upstream.listen(0, r));
  process.env.MISTRAL_URL = `http://127.0.0.1:${upstream.address().port}/v1`;

  ({ server: proxy } = await import('../server.js'));
  await new Promise(r => proxy.listen(0, r));
  base = `http://127.0.0.1:${proxy.address().port}`;
});

after(() => {
  proxy.close();
  upstream.close();
});

beforeEach(async () => {
  upstreamCalls = [];
  upstreamStatus = 200;
  const { __reset } = await import('../limits.js');
  __reset();
});

const call = (body, headers = {}) =>
  fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dosar-Key': 'app-token',
      'X-Dosar-Device': 'device-aaaaaaaa',
      ...headers,
    },
    body: JSON.stringify(body),
  });

const valid = {
  model: 'mistral-small-latest',
  messages: [{ role: 'user', content: 'salut' }],
  max_tokens: 500,
};

test('releaza o cerere valida si adauga cheia server-side', async () => {
  const res = await call(valid);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).choices[0].message.content, 'salut');
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].auth, 'Bearer test-key');
});

test('cheia aplicatiei lipsa => 401, fara apel upstream', async () => {
  const res = await call(valid, { 'X-Dosar-Key': 'gresit' });
  assert.equal(res.status, 401);
  assert.equal(upstreamCalls.length, 0);
});

test('accepta token-ul si ca Authorization: Bearer', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer app-token',
      'X-Dosar-Device': 'device-bbbbbbbb',
    },
    body: JSON.stringify(valid),
  });
  assert.equal(res.status, 200);
  // cheia reala e adaugata server-side, nu cea trimisa de client
  assert.equal(upstreamCalls[0].auth, 'Bearer test-key');
});

test('Bearer gresit => 401', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nu-e-bun' },
    body: JSON.stringify(valid),
  });
  assert.equal(res.status, 401);
  assert.equal(upstreamCalls.length, 0);
});

test('model din afara listei => 403, fara apel upstream', async () => {
  const res = await call({ ...valid, model: 'mistral-medium-latest' });
  assert.equal(res.status, 403);
  assert.equal(upstreamCalls.length, 0);
});

test('max_tokens e plafonat, nu respins', async () => {
  const res = await call({ ...valid, max_tokens: 999999 });
  assert.equal(res.status, 200);
  assert.equal(upstreamCalls[0].body.max_tokens, 1000);
});

test('campurile necunoscute nu ajung la provider', async () => {
  await call({ ...valid, n: 50, stream: true, tools: [{ x: 1 }] });
  const sent = upstreamCalls[0].body;
  assert.equal(sent.n, undefined);
  assert.equal(sent.tools, undefined);
  assert.equal(sent.stream, false);
});

test('limita per device => 429 dupa 2 cereri', async () => {
  assert.equal((await call(valid)).status, 200);
  assert.equal((await call(valid)).status, 200);
  const third = await call(valid);
  assert.equal(third.status, 429);
  assert.match((await third.json()).error.message, /limita de 2/);
  assert.equal(upstreamCalls.length, 2);
});

test('limita globala prinde si device-uri diferite', async () => {
  await call(valid, { 'X-Dosar-Device': 'device-11111111' });
  await call(valid, { 'X-Dosar-Device': 'device-11111111' });
  await call(valid, { 'X-Dosar-Device': 'device-22222222' });
  const res = await call(valid, { 'X-Dosar-Device': 'device-33333333' });
  assert.equal(res.status, 429);
  assert.match((await res.json()).error.message, /plafonul zilnic/);
});

test('mesaje vision (content ca lista de blocuri) trec', async () => {
  const res = await call({
    model: 'pixtral-large-latest',
    messages: [
      { role: 'system', content: 'extrage' },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
          { type: 'text', text: 'ce scrie?' },
        ],
      },
    ],
    max_tokens: 800,
  });
  assert.equal(res.status, 200);
  assert.equal(upstreamCalls[0].body.messages.length, 2);
});

test('401 de la provider devine 503 (problema noastra, nu a userului)', async () => {
  upstreamStatus = 401;
  const res = await call(valid);
  assert.equal(res.status, 503);
  assert.match((await res.json()).error.message, /indisponibil/i);
});

test('403 de la provider devine tot 503', async () => {
  upstreamStatus = 403;
  const res = await call(valid);
  assert.equal(res.status, 503);
});

test('429 de la provider ramane 429 (mesajul din app e corect)', async () => {
  upstreamStatus = 429;
  const res = await call(valid);
  assert.equal(res.status, 429);
});

test('traduce numele modelului spre provider', async () => {
  const res = await call(valid);
  assert.equal(res.status, 200);
  // clientul a cerut mistral-small-latest, providerul a primit modelul Gemini
  assert.equal(upstreamCalls[0].body.model, 'gemini-3.8-flash');
});

test('whitelist-ul se aplica pe numele primit, nu pe cel tradus', async () => {
  // un nume Gemini trimis direct de client NU e in whitelist => 403
  const res = await call({ ...valid, model: 'gemini-3.8-flash' });
  assert.equal(res.status, 403);
  assert.equal(upstreamCalls.length, 0);
});

test('trimite reasoning_effort cand e configurat', async () => {
  await call(valid);
  // fara asta, gandirea modelului consuma din max_tokens si raspunsul vine gol
  assert.equal(upstreamCalls[0].body.reasoning_effort, 'none');
});

test('JSON invalid => 400', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dosar-Key': 'app-token' },
    body: 'nu-i json',
  });
  assert.equal(res.status, 400);
});

test('health raspunde fara autentificare', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('endpoint necunoscut => 404', async () => {
  const res = await fetch(`${base}/v1/models`);
  assert.equal(res.status, 404);
});
