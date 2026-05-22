# Doctor Share — Implementation Plan (F8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementează partajare dosar medical cu medic prin link 1h criptat E2E. Storage S3-compatible (Danubedata primar, Scaleway alternativ — decizie la deploy în Task 19). Compute Rapids serverless (Danubedata, EU/DE).

**Spec:** `docs/superpowers/specs/2026-05-22-doctor-share-design.md`

**Architecture:**
- App (Dosar) → POST /upload la Rapids → primește pre-signed PUT URL → PUT direct la S3
- Doctor (browser) → GET /share/:id la Rapids → primește pre-signed GET URL → fetch din S3 → decrypt în memorie

**Tech stack:**
- Relay: TypeScript + Hono + AWS SDK S3 client, packaged ca Docker container
- Viewer: Vite + vanilla TypeScript + JSZip + PDF.js, deploy pe GitHub Pages
- App: extinde `services/medicalCrypto.ts` patterns existente

---

## File Map (overview)

### Fișiere noi în repo

```
cloud/
├── share-relay/
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── src/
│   │   ├── index.ts          # Hono router cu 4 endpoints
│   │   ├── s3.ts             # Pre-signed URL signing
│   │   ├── kv.ts             # In-memory KV pentru metadata + rate-limit
│   │   └── config.ts         # Env var parsing
│   ├── tests/
│   │   └── index.test.ts
│   └── README.md             # Deploy guide Rapids
└── share-viewer/
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    ├── index.html
    ├── public/
    │   └── favicon.svg
    ├── src/
    │   ├── main.ts           # Fragment parse → fetch → decrypt → render
    │   ├── crypto.ts         # Web Crypto API wrapper
    │   ├── ui/
    │   │   ├── header.ts     # Patient info + countdown
    │   │   ├── timeline.ts   # Observation list + sparkline
    │   │   ├── sparkline.ts  # SVG inline, zero-deps
    │   │   ├── docs-list.ts  # Documents grid cu thumbnails
    │   │   └── doc-viewer.ts # Modal full-screen PDF/image
    │   └── styles.css
    └── README.md             # Deploy guide GitHub Pages

app/
├── components/medical/
│   ├── ShareDoctorSheet.tsx        # Modal config share
│   ├── ShareSuccessModal.tsx       # Modal link + copy + share + revoke
│   └── ShareHistoryList.tsx        # Listă share-uri active
├── app/(tabs)/entitati/medical/[id]/
│   └── share-history.tsx           # Ecran istoric share-uri
└── services/
    ├── medicalShare.ts             # Bundle + crypt + upload
    ├── medicalShareHistory.ts      # CRUD medical_shares
    └── medicalShareConfig.ts       # Constants (URLs, limits)
```

### Fișiere modificate

```
app/
├── app/(tabs)/entitati/medical/[id]/index.tsx   # Buton "Partajează"
├── app/(tabs)/setari.tsx                         # Toggle betaShareEnabled
├── services/settings.ts                          # getBetaShareEnabled, set...
└── types/index.ts                                # Type ShareConfig, ShareEstimate
```

---

## Faza F8a: Relay Rapids (TypeScript container)

### Task 1: Inițializare `cloud/share-relay/`

**Files:**
- Create: `cloud/share-relay/package.json`
- Create: `cloud/share-relay/tsconfig.json`
- Create: `cloud/share-relay/Dockerfile`

- [ ] **Step 1: Crează folder + npm init**

```bash
mkdir -p /Users/ax/work/documents/cloud/share-relay
cd /Users/ax/work/documents/cloud/share-relay
npm init -y
```

- [ ] **Step 2: Instalează dependențe**

```bash
npm install hono @aws-sdk/client-s3 @aws-sdk/s3-request-presigner zod
npm install -D typescript @types/node tsx vitest
```

- [ ] **Step 3: `package.json` scripts**

```json
{
  "name": "dosar-share-relay",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  }
}
```

- [ ] **Step 4: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 5: `Dockerfile`**

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

- [ ] **Step 6: `.gitignore` și `.dockerignore`**

```
# .gitignore
node_modules/
dist/
.env
.env.local
*.log

# .dockerignore
node_modules
dist
.git
*.md
tests
```

- [ ] **Step 7: Commit**

```bash
cd /Users/ax/work/documents/app
git add ../cloud/share-relay/
git commit -m "feat(share): initialize relay container (Hono + AWS SDK + TS)"
```

---

### Task 2: Config + env parsing (`src/config.ts`)

**Files:**
- Create: `cloud/share-relay/src/config.ts`

- [ ] **Step 1: Definiție env**

```ts
import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(8080),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('eu-central-1'),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  // Maximum blob size (bytes) accepted la upload
  MAX_BLOB_SIZE_BYTES: z.coerce.number().default(100 * 1024 * 1024), // 100MB
  // TTL per share — câtă vreme pre-signed download URL e valabil
  SHARE_TTL_SECONDS: z.coerce.number().default(3600), // 1h
  // Upload URL TTL — câtă vreme pre-signed PUT URL e valabil
  UPLOAD_TTL_SECONDS: z.coerce.number().default(300), // 5min
  // Rate limit: max upload-uri per IP per zi
  RATE_LIMIT_PER_IP_PER_DAY: z.coerce.number().default(10),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse(process.env);
}
```

- [ ] **Step 2: Commit**

```bash
git add cloud/share-relay/src/config.ts
git commit -m "feat(share): env config parsing with Zod"
```

---

### Task 3: KV abstraction (`src/kv.ts`)

**Files:**
- Create: `cloud/share-relay/src/kv.ts`

In-memory KV cu cleanup automat. Pentru MVP — suficient pentru un singur container Rapids. Migrare la Redis ulterior dacă scalăm orizontal.

- [ ] **Step 1: KV cu TTL**

```ts
interface KVRecord {
  id: string;
  createdAt: number;     // ms epoch
  expiresAt: number;     // ms epoch
  revokedAt?: number;
  sizeBytes: number;
  docCount: number;
  obsCount: number;
}

class InMemoryKV {
  private store = new Map<string, KVRecord>();

  set(id: string, record: KVRecord): void {
    this.store.set(id, record);
  }

  get(id: string): KVRecord | undefined {
    const record = this.store.get(id);
    if (!record) return undefined;
    if (record.expiresAt < Date.now()) {
      this.store.delete(id);
      return undefined;
    }
    return record;
  }

  revoke(id: string): boolean {
    const record = this.store.get(id);
    if (!record) return false;
    record.revokedAt = Date.now();
    return true;
  }

  // Auto-cleanup: invocat din setInterval la fiecare 5 min
  cleanup(): number {
    const now = Date.now();
    let deleted = 0;
    for (const [id, record] of this.store) {
      // Șterge după 24h (catch-all safety net dincolo de TTL 1h)
      if (record.createdAt + 24 * 3600 * 1000 < now) {
        this.store.delete(id);
        deleted++;
      }
    }
    return deleted;
  }
}

// Rate limit per IP per zi
class RateLimiter {
  private counts = new Map<string, { count: number; resetAt: number }>();

  check(ip: string, max: number): boolean {
    const now = Date.now();
    const entry = this.counts.get(ip);
    if (!entry || entry.resetAt < now) {
      this.counts.set(ip, { count: 1, resetAt: now + 24 * 3600 * 1000 });
      return true;
    }
    if (entry.count >= max) return false;
    entry.count++;
    return true;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [ip, entry] of this.counts) {
      if (entry.resetAt < now) this.counts.delete(ip);
    }
  }
}

export const kv = new InMemoryKV();
export const rateLimit = new RateLimiter();

// Auto-cleanup la fiecare 5 min
setInterval(() => {
  kv.cleanup();
  rateLimit.cleanup();
}, 5 * 60 * 1000);
```

- [ ] **Step 2: Commit**

```bash
git add cloud/share-relay/src/kv.ts
git commit -m "feat(share): in-memory KV + rate limiter with auto-cleanup"
```

---

### Task 4: S3 client + pre-signed URLs (`src/s3.ts`)

**Files:**
- Create: `cloud/share-relay/src/s3.ts`

- [ ] **Step 1: Client + helpers**

```ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from './config.js';

export function createS3Client(config: Config): S3Client {
  return new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    },
    forcePathStyle: true, // necesar pentru Ceph (Danubedata) + opțional pentru Scaleway
  });
}

export async function signUploadUrl(
  client: S3Client,
  config: Config,
  id: string,
  contentLength: number
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: `shares/${id}`,
    ContentLength: contentLength,
    ContentType: 'application/octet-stream',
    Metadata: {
      'x-share-created-at': new Date().toISOString(),
    },
  });
  return await getSignedUrl(client, cmd, { expiresIn: config.UPLOAD_TTL_SECONDS });
}

export async function signDownloadUrl(
  client: S3Client,
  config: Config,
  id: string,
  expiresIn: number
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: `shares/${id}`,
  });
  return await getSignedUrl(client, cmd, { expiresIn });
}

export async function deleteBlob(client: S3Client, config: Config, id: string): Promise<void> {
  await client.send(
    new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: `shares/${id}` })
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add cloud/share-relay/src/s3.ts
git commit -m "feat(share): S3 pre-signed URL helpers (upload/download/delete)"
```

---

### Task 5: Hono router (`src/index.ts`)

**Files:**
- Create: `cloud/share-relay/src/index.ts`

- [ ] **Step 1: Router cu 4 endpoints**

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { kv, rateLimit } from './kv.js';
import { createS3Client, signUploadUrl, signDownloadUrl, deleteBlob } from './s3.js';

const config = loadConfig();
const s3 = createS3Client(config);
const app = new Hono();

// CORS: deschis pentru viewer (origin GitHub Pages) + app (Expo)
app.use('*', cors({
  origin: '*', // restrictăm la origin-uri concrete în Task 19 deploy
  allowHeaders: ['Content-Type'],
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
}));

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/upload', async (c) => {
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown';
  if (!rateLimit.check(ip, config.RATE_LIMIT_PER_IP_PER_DAY)) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.sizeBytes !== 'number' || typeof body.docCount !== 'number') {
    return c.json({ error: 'Invalid body' }, 400);
  }
  if (body.sizeBytes > config.MAX_BLOB_SIZE_BYTES) {
    return c.json({ error: 'Blob too large', maxBytes: config.MAX_BLOB_SIZE_BYTES }, 413);
  }

  const id = randomUUID();
  const createdAt = Date.now();
  const expiresAt = createdAt + config.SHARE_TTL_SECONDS * 1000;

  const uploadUrl = await signUploadUrl(s3, config, id, body.sizeBytes);

  kv.set(id, {
    id,
    createdAt,
    expiresAt,
    sizeBytes: body.sizeBytes,
    docCount: body.docCount,
    obsCount: body.obsCount ?? 0,
  });

  return c.json({
    id,
    uploadUrl,
    expiresAt: new Date(expiresAt).toISOString(),
    uploadTtlSeconds: config.UPLOAD_TTL_SECONDS,
  });
});

app.get('/share/:id', async (c) => {
  const id = c.req.param('id');
  const record = kv.get(id);
  if (!record) return c.json({ error: 'Not found or expired' }, 404);
  if (record.revokedAt) return c.json({ error: 'Revoked' }, 410);

  const remainingSeconds = Math.max(0, Math.floor((record.expiresAt - Date.now()) / 1000));
  if (remainingSeconds <= 0) return c.json({ error: 'Expired' }, 404);

  const downloadUrl = await signDownloadUrl(s3, config, id, remainingSeconds);
  return c.json({
    id,
    downloadUrl,
    expiresAt: new Date(record.expiresAt).toISOString(),
    docCount: record.docCount,
    obsCount: record.obsCount,
  });
});

app.delete('/share/:id', async (c) => {
  const id = c.req.param('id');
  const record = kv.get(id);
  if (!record) return c.json({ error: 'Not found' }, 404);

  try {
    await deleteBlob(s3, config, id);
  } catch (e) {
    console.warn('[share] S3 delete failed:', e);
    // Continuă — marcăm revoked oricum; lifecycle rule prinde restul
  }
  kv.revoke(id);
  return c.body(null, 204);
});

// Pornește serverul
const port = config.PORT;
console.log(`Dosar share relay listening on :${port}`);

import { serve } from '@hono/node-server';
serve({ fetch: app.fetch, port });

export default app; // pentru teste
```

- [ ] **Step 2: Adaugă `@hono/node-server` la dependencies**

```bash
cd /Users/ax/work/documents/cloud/share-relay
npm install @hono/node-server
```

- [ ] **Step 3: Test local cu mock env**

```bash
S3_ENDPOINT=http://localhost:9000 S3_BUCKET=test S3_ACCESS_KEY=test S3_SECRET_KEY=test \
  npm run dev
```

Verifică:
- `curl http://localhost:8080/health` returnează 200
- `curl -X POST -H "Content-Type: application/json" -d '{"sizeBytes":1024,"docCount":1}' http://localhost:8080/upload` returnează `{id, uploadUrl, expiresAt}`

- [ ] **Step 4: Commit**

```bash
git add cloud/share-relay/
git commit -m "feat(share): Hono router with 4 endpoints (upload/share/revoke/health)"
```

---

### Task 6: Teste unit (`tests/index.test.ts`)

**Files:**
- Create: `cloud/share-relay/tests/index.test.ts`

- [ ] **Step 1: Teste cu mock S3**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @aws-sdk/s3-request-presigner pentru a evita network calls
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://mock.s3/presigned'),
}));

// Set env înainte de import index.ts
process.env.S3_ENDPOINT = 'https://mock.s3';
process.env.S3_BUCKET = 'test';
process.env.S3_ACCESS_KEY = 'test';
process.env.S3_SECRET_KEY = 'test';

describe('share relay', () => {
  let app: any;
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../src/index.js');
    app = mod.default;
  });

  it('GET /health returns ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
  });

  it('POST /upload returns id + uploadUrl', async () => {
    const res = await app.request('/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sizeBytes: 1024, docCount: 1, obsCount: 5 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(json.uploadUrl).toBe('https://mock.s3/presigned');
  });

  it('POST /upload rejects blob too large', async () => {
    const res = await app.request('/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sizeBytes: 200 * 1024 * 1024, docCount: 1 }),
    });
    expect(res.status).toBe(413);
  });

  it('GET /share/:id returns 404 for unknown id', async () => {
    const res = await app.request('/share/unknown-id');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Rulează testele**

```bash
npm test
```

Expected: 4/4 pass.

- [ ] **Step 3: Commit**

```bash
git add cloud/share-relay/tests/
git commit -m "test(share): unit tests for relay endpoints (mock S3)"
```

---

### Task 7: README deploy relay

**Files:**
- Create: `cloud/share-relay/README.md`

- [ ] **Step 1: Document deploy steps**

```markdown
# Dosar Share Relay

Cloudless containerized relay for Dosar medical share feature.
Issues pre-signed S3 URLs; never touches encrypted blobs directly.

## Local dev

\`\`\`bash
npm install
S3_ENDPOINT=... S3_BUCKET=... S3_ACCESS_KEY=... S3_SECRET_KEY=... npm run dev
\`\`\`

## Deploy to Danubedata Rapids

1. Build + push imagine Docker la Container Registry Danubedata:
\`\`\`bash
docker build -t cr.danubedata.ro/<user>/dosar-share-relay:latest .
docker push cr.danubedata.ro/<user>/dosar-share-relay:latest
\`\`\`

2. În Rapids dashboard: New container → pull from `cr.danubedata.ro/<user>/dosar-share-relay:latest`
3. Configurează env vars (vezi config.ts pentru lista completă).
4. Atașează domain (default: `<name>.serverless.danubedata.ro`).
5. Set resource profile: Micro (0.25 vCPU, 128MB RAM) suficient pentru >2M req/lună.

## Migration to Scaleway

Same Docker image. Change:
\`\`\`bash
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_BUCKET=dosar-shares
\`\`\`

## API

- `GET /health` — uptime check
- `POST /upload` — accept `{sizeBytes, docCount, obsCount}`, return `{id, uploadUrl, expiresAt}`
- `GET /share/:id` — return `{downloadUrl, expiresAt, docCount, obsCount}` or 404/410
- `DELETE /share/:id` — revoke, return 204
```

- [ ] **Step 2: Commit**

```bash
git add cloud/share-relay/README.md
git commit -m "docs(share): relay deploy guide for Rapids + Scaleway migration notes"
```

---

## Faza F8b: Viewer static (Vite + vanilla TS)

### Task 8: Inițializare `cloud/share-viewer/`

**Files:**
- Create: `cloud/share-viewer/package.json` + Vite config

- [ ] **Step 1: Init**

```bash
mkdir -p /Users/ax/work/documents/cloud/share-viewer
cd /Users/ax/work/documents/cloud/share-viewer
npm init -y
npm install jszip pdfjs-dist
npm install -D typescript vite @types/node
```

- [ ] **Step 2: `vite.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/dosar-share/', // sub-path pe GH Pages: tudorabrudan.github.io/dosar-share/
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          pdfjs: ['pdfjs-dist'],
        },
      },
    },
  },
});
```

- [ ] **Step 3: `tsconfig.json` minimal**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"],
    "types": ["vite/client"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Commit**

```bash
git add cloud/share-viewer/
git commit -m "feat(share-viewer): init Vite + vanilla TS + JSZip + pdfjs"
```

---

### Task 9: Crypto helper (`src/crypto.ts`)

**Files:**
- Create: `cloud/share-viewer/src/crypto.ts`

- [ ] **Step 1: Web Crypto API wrapper**

```ts
/**
 * Decriptează un blob AES-256-GCM cu cheia și nonce din URL fragment.
 * AAD = "dosar-share-v1:<blob-id>" (must match app/services/medicalShare.ts).
 */
export async function decryptShare(
  encryptedBlob: ArrayBuffer,
  keyBase64Url: string,
  nonceBase64Url: string,
  blobId: string
): Promise<ArrayBuffer> {
  const keyBytes = base64UrlDecode(keyBase64Url);
  const nonceBytes = base64UrlDecode(nonceBase64Url);
  const aad = new TextEncoder().encode(`dosar-share-v1:${blobId}`);

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonceBytes, additionalData: aad },
    key,
    encryptedBlob
  );

  return plaintext;
}

function base64UrlDecode(s: string): Uint8Array {
  // Convert base64url → standard base64
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const withPad = padded + '='.repeat((4 - padded.length % 4) % 4);
  const binary = atob(withPad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
```

- [ ] **Step 2: Commit**

```bash
git add cloud/share-viewer/src/crypto.ts
git commit -m "feat(share-viewer): Web Crypto API decrypt wrapper"
```

---

### Task 10: Sparkline SVG (`src/ui/sparkline.ts`)

**Files:**
- Create: `cloud/share-viewer/src/ui/sparkline.ts`

- [ ] **Step 1: SVG inline zero-deps**

```ts
export interface SparklinePoint { x: number; y: number; }

export function renderSparkline(values: number[], width = 120, height = 32): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const dx = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * dx;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${points.join(' ')}" />
  </svg>`;
}
```

- [ ] **Step 2: Commit**

```bash
git add cloud/share-viewer/src/ui/sparkline.ts
git commit -m "feat(share-viewer): inline SVG sparkline renderer"
```

---

### Task 11: Header (`src/ui/header.ts`)

**Files:**
- Create: `cloud/share-viewer/src/ui/header.ts`

- [ ] **Step 1: Patient header + countdown**

```ts
interface PatientInfo {
  name: string;
  dateOfBirth?: string;
  bloodGroup?: string;
  allergies?: string;
  emergencyContact?: { name: string; phone: string };
}

export function renderHeader(patient: PatientInfo, expiresAt: Date): HTMLElement {
  const el = document.createElement('header');
  el.className = 'patient-header';

  const age = patient.dateOfBirth
    ? Math.floor((Date.now() - new Date(patient.dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000))
    : null;

  el.innerHTML = `
    <h1>${escapeHtml(patient.name)}${age !== null ? ` <span class="age">· ${age} ani</span>` : ''}</h1>
    ${patient.bloodGroup ? `<div class="badge blood-group">${escapeHtml(patient.bloodGroup)}</div>` : ''}
    ${patient.allergies ? `<div class="alert allergies">⚠️ Alergii: ${escapeHtml(patient.allergies)}</div>` : ''}
    ${patient.emergencyContact ? `
      <div class="emergency">
        Contact urgență: ${escapeHtml(patient.emergencyContact.name)}
        <a href="tel:${encodeURIComponent(patient.emergencyContact.phone)}">${escapeHtml(patient.emergencyContact.phone)}</a>
      </div>` : ''}
    <div class="countdown">Acest link expiră în <span class="countdown-time"></span></div>
  `;

  const countdownEl = el.querySelector('.countdown-time')!;
  function updateCountdown() {
    const remaining = expiresAt.getTime() - Date.now();
    if (remaining <= 0) {
      countdownEl.textContent = 'expirat';
      el.classList.add('expired');
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    countdownEl.textContent = `${mins}m ${secs}s`;
  }
  updateCountdown();
  setInterval(updateCountdown, 1000);

  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));
}
```

- [ ] **Step 2: Commit**

```bash
git add cloud/share-viewer/src/ui/header.ts
git commit -m "feat(share-viewer): patient header + live countdown"
```

---

### Task 12: Timeline + docs list + doc viewer

**Files:**
- Create: `cloud/share-viewer/src/ui/timeline.ts`
- Create: `cloud/share-viewer/src/ui/docs-list.ts`
- Create: `cloud/share-viewer/src/ui/doc-viewer.ts`

- [ ] **Step 1: Timeline cu observații + sparkline**

(Detalii UI; vezi spec §8.2 pentru shape-uri exact. Cod ~150 linii — grupare după nume, sparkline per grup, drill-down la documentul sursă.)

- [ ] **Step 2: Docs list cu thumbnail grid**

- [ ] **Step 3: Doc viewer (PDF + image full-screen modal)**

- [ ] **Step 4: Commit**

```bash
git add cloud/share-viewer/src/ui/
git commit -m "feat(share-viewer): timeline, docs list, full-screen doc viewer"
```

---

### Task 13: Main entry (`src/main.ts`)

**Files:**
- Create: `cloud/share-viewer/src/main.ts`
- Create: `cloud/share-viewer/index.html`
- Create: `cloud/share-viewer/src/styles.css`

- [ ] **Step 1: Main flow**

```ts
import JSZip from 'jszip';
import { decryptShare } from './crypto.js';
import { renderHeader } from './ui/header.js';
import { renderTimeline } from './ui/timeline.js';
import { renderDocsList } from './ui/docs-list.js';
import './styles.css';

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? 'https://dosar-share.serverless.danubedata.ro';

interface Manifest {
  version: number;
  generatedAt: string;
  expiresAt: string;
  patient: any;
  observations: any[];
  documents: any[];
}

async function main() {
  const root = document.getElementById('root')!;
  root.innerHTML = '<div class="loading">Se decriptează datele pacientului...</div>';

  // Parse fragment
  const fragment = location.hash.slice(1);
  const params = new URLSearchParams(fragment);
  const k = params.get('k'), n = params.get('n'), b = params.get('b');
  if (!k || !n || !b) {
    root.innerHTML = '<div class="error">Link invalid. Cere pacientului un link nou.</div>';
    return;
  }

  try {
    // Get pre-signed download URL from relay
    const shareRes = await fetch(`${RELAY_URL}/share/${b}`);
    if (!shareRes.ok) {
      if (shareRes.status === 404) {
        root.innerHTML = '<div class="error">Link expirat sau inexistent. Cere pacientului unul nou.</div>';
      } else if (shareRes.status === 410) {
        root.innerHTML = '<div class="error">Linkul a fost revocat de pacient.</div>';
      } else {
        root.innerHTML = '<div class="error">Eroare server. Încearcă din nou.</div>';
      }
      return;
    }
    const { downloadUrl, expiresAt } = await shareRes.json();

    // Fetch encrypted blob directly from S3
    const blobRes = await fetch(downloadUrl);
    if (!blobRes.ok) {
      root.innerHTML = '<div class="error">Datele nu mai sunt disponibile.</div>';
      return;
    }
    const encrypted = await blobRes.arrayBuffer();

    // Decrypt in memory
    const plaintext = await decryptShare(encrypted, k, n, b);

    // Extract ZIP
    const zip = await JSZip.loadAsync(plaintext);
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      root.innerHTML = '<div class="error">Bundle corupt (lipsește manifest).</div>';
      return;
    }
    const manifest: Manifest = JSON.parse(await manifestFile.async('string'));

    // Render UI
    root.innerHTML = '';
    root.appendChild(renderHeader(manifest.patient, new Date(expiresAt)));
    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    tabs.innerHTML = `
      <button data-tab="timeline" class="active">Timeline (${manifest.observations.length})</button>
      <button data-tab="docs">Documente (${manifest.documents.length})</button>
    `;
    root.appendChild(tabs);

    const timelineEl = renderTimeline(manifest.observations);
    const docsEl = await renderDocsList(manifest.documents, zip);
    root.appendChild(timelineEl);
    root.appendChild(docsEl);
    docsEl.style.display = 'none';

    tabs.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName !== 'BUTTON') return;
      tabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      target.classList.add('active');
      const tab = target.dataset.tab;
      timelineEl.style.display = tab === 'timeline' ? '' : 'none';
      docsEl.style.display = tab === 'docs' ? '' : 'none';
    });
  } catch (e) {
    console.error(e);
    root.innerHTML = '<div class="error">Eroare la decriptare. Browser-ul tău poate fi prea vechi (necesar Chrome/Safari/Firefox recent).</div>';
  }
}

main();
```

- [ ] **Step 2: `index.html`**

```html
<!doctype html>
<html lang="ro">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dosar Medical — Partajat</title>
  <meta name="robots" content="noindex,nofollow" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 3: `styles.css` minimal (Romanian medical theme)**

Light + dark mode via `prefers-color-scheme`. Colors aligned cu Dosar app design system (primary `#9EB567`).

- [ ] **Step 4: Test local**

```bash
cd /Users/ax/work/documents/cloud/share-viewer
npm run dev
```

Verifică: deschide `http://localhost:5173/dosar-share/#k=mock&n=mock&b=mock` — ar trebui să arate error "Link expirat" (relay returnează 404).

- [ ] **Step 5: Commit**

```bash
git add cloud/share-viewer/
git commit -m "feat(share-viewer): main entry — fragment parse + fetch + decrypt + render"
```

---

### Task 14: README deploy viewer

**Files:**
- Create: `cloud/share-viewer/README.md`

- [ ] **Step 1: Document GH Pages deploy**

```markdown
# Dosar Share Viewer

Static page for doctors to view medical share links from Dosar app.
Zero backend — fetches encrypted blob from S3 (via relay), decrypts in browser.

## Local dev

\`\`\`bash
npm install
VITE_RELAY_URL=http://localhost:8080 npm run dev
\`\`\`

## Deploy to GitHub Pages

1. Build:
\`\`\`bash
VITE_RELAY_URL=https://dosar-share.serverless.danubedata.ro npm run build
\`\`\`

2. Deploy `dist/` la branch `gh-pages` în repo `tudorAbrudan/tudorAbrudan.github.io`:
\`\`\`bash
git subtree push --prefix=dist origin gh-pages
\`\`\`

3. Sau cu `gh-pages` package:
\`\`\`bash
npx gh-pages -d dist -b gh-pages
\`\`\`

## URL final
\`\`\`
https://tudorabrudan.github.io/dosar-share/#k=...&n=...&b=...
\`\`\`
```

- [ ] **Step 2: Commit**

```bash
git add cloud/share-viewer/README.md
git commit -m "docs(share-viewer): deploy guide for GitHub Pages"
```

---

## Faza F8c: App integration

### Task 15: `services/medicalShareConfig.ts` + types

**Files:**
- Create: `app/services/medicalShareConfig.ts`
- Modify: `app/types/index.ts`

- [ ] **Step 1: Config constants**

```ts
// app/services/medicalShareConfig.ts
export const SHARE_RELAY_URL = 'https://dosar-share.serverless.danubedata.ro';
export const SHARE_VIEWER_URL = 'https://tudorabrudan.github.io/dosar-share';
export const SHARE_MAX_BYTES = 100 * 1024 * 1024; // 100MB
export const SHARE_MAX_DOCUMENTS = 50;
export const SHARE_DEFAULT_INTERVAL_MONTHS = 6;
export const SHARE_AAD_PREFIX = 'dosar-share-v1';
```

- [ ] **Step 2: TS types**

```ts
// types/index.ts — adăugare după MedicalShare
export interface ShareConfig {
  includeObservations: boolean;
  includeDocuments: boolean;
  includeSummaries: boolean;
  intervalMonths: 3 | 6 | 12 | null; // null = all
  docTypeFilter: DocumentType[]; // empty = all medical types
}

export interface ShareEstimate {
  sizeBytes: number;
  docCount: number;
  obsCount: number;
}
```

- [ ] **Step 3: Commit**

```bash
git add services/medicalShareConfig.ts types/index.ts
git commit -m "feat(share): app-side config constants + ShareConfig/Estimate types"
```

---

### Task 16: `services/medicalShare.ts` — bundle + crypt + upload

**Files:**
- Create: `app/services/medicalShare.ts`

- [ ] **Step 1: Bundle builder + uploader**

```ts
import JSZip from 'jszip';
import * as FileSystem from 'expo-file-system';
import { gcm } from '@noble/ciphers/aes.js';
import { getMedicalRecord } from './medicalRecord';
import { listObservationsByRecord } from './medicalObservations';
import { getDocumentsByEntityId } from './documents';
import { getPersons } from './entities';
import {
  SHARE_RELAY_URL, SHARE_VIEWER_URL, SHARE_MAX_BYTES, SHARE_MAX_DOCUMENTS,
  SHARE_AAD_PREFIX,
} from './medicalShareConfig';
import type { ShareConfig, ShareEstimate } from '@/types';
import * as ImageManipulator from 'expo-image-manipulator';

export async function estimateShareSize(
  recordId: string,
  config: ShareConfig
): Promise<ShareEstimate> {
  // Calculează size aproximativ fără a construi bundle-ul
  // (sumă file sizes + manifest estimat ~5KB)
  // ... implementare
}

export interface ShareResult {
  shareUrl: string;
  shareId: string;
  expiresAt: string;
}

export async function buildAndUploadShare(
  recordId: string,
  config: ShareConfig,
  onProgress?: (stage: string, pct: number) => void
): Promise<ShareResult> {
  // 1. Load record, person, observations, documents
  onProgress?.('Pregătesc bundle...', 5);
  const record = await getMedicalRecord(recordId);
  if (!record) throw new Error('Dosar inexistent');
  const persons = await getPersons();
  const person = persons.find(p => p.id === record.person_id);

  const observations = config.includeObservations
    ? await listObservationsByRecord(recordId)
    : [];
  const allDocs = config.includeDocuments
    ? await getDocumentsByEntityId('medical_record', recordId)
    : [];
  const filteredDocs = filterDocsByConfig(allDocs, config);

  if (filteredDocs.length > SHARE_MAX_DOCUMENTS) {
    throw new Error(`Prea multe documente (${filteredDocs.length}, maxim ${SHARE_MAX_DOCUMENTS}). Restrânge intervalul sau tipurile.`);
  }

  // 2. Build manifest
  onProgress?.('Construiesc manifest...', 15);
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    patient: {
      name: person?.name ?? record.name,
      dateOfBirth: person?.date_of_birth,
      bloodGroup: record.blood_group,
      allergies: record.allergies,
      emergencyContact: record.emergency_contact_name
        ? { name: record.emergency_contact_name, phone: record.emergency_contact_phone ?? '' }
        : undefined,
    },
    observations: observations.map(o => ({
      name: o.name, value: o.value, unit: o.unit,
      ref_min: o.ref_min, ref_max: o.ref_max,
      observed_at: o.observed_at, category: o.category,
      source_document_id: o.source_document_id,
    })),
    documents: filteredDocs.map(d => ({
      id: d.id, type: d.type, title: d.note?.slice(0, 100),
      issue_date: d.issue_date,
      filename: `documents/${d.id}${getExt(d.file_path)}`,
      thumbnail: `thumbnails/${d.id}.jpg`,
      size_bytes: 0, // populated after compression
      summary: d.note,
    })),
  };

  // 3. Build ZIP
  onProgress?.('Comprim documente...', 30);
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  for (let i = 0; i < filteredDocs.length; i++) {
    const doc = filteredDocs[i];
    if (!doc.file_path) continue;
    const fullPath = `${FileSystem.documentDirectory}${doc.file_path}`;
    const content = await FileSystem.readAsStringAsync(fullPath, { encoding: 'base64' });
    zip.file(`documents/${doc.id}${getExt(doc.file_path)}`, content, { base64: true });

    // Thumbnail (200x200, JPEG q70)
    if (isImage(doc.file_path)) {
      const thumb = await ImageManipulator.manipulateAsync(
        fullPath, [{ resize: { width: 200 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (thumb.base64) zip.file(`thumbnails/${doc.id}.jpg`, thumb.base64, { base64: true });
    }
    onProgress?.(`Comprim documente... (${i+1}/${filteredDocs.length})`, 30 + (i+1)/filteredDocs.length * 30);
  }

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  if (zipBytes.length > SHARE_MAX_BYTES) {
    throw new Error(`Bundle prea mare (${Math.round(zipBytes.length/1024/1024)}MB, maxim 100MB). Restrânge intervalul.`);
  }

  // 4. Encrypt
  onProgress?.('Criptez...', 70);
  const key = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));

  // 5. POST /upload to get pre-signed URL
  onProgress?.('Conectare server...', 80);
  const uploadRes = await fetch(`${SHARE_RELAY_URL}/upload`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sizeBytes: zipBytes.length + 16, // GCM tag overhead
      docCount: filteredDocs.length,
      obsCount: observations.length,
    }),
  });
  if (!uploadRes.ok) throw new Error('Eroare server la inițiere upload');
  const { id, uploadUrl, expiresAt } = await uploadRes.json();

  // 6. Encrypt with AAD = SHARE_AAD_PREFIX:id
  const aad = new TextEncoder().encode(`${SHARE_AAD_PREFIX}:${id}`);
  const cipher = gcm(key, nonce, aad);
  const encrypted = cipher.encrypt(zipBytes);

  // 7. PUT direct to S3 via pre-signed URL
  onProgress?.('Trimit la server criptat...', 90);
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: encrypted,
  });
  if (!putRes.ok) throw new Error('Eroare upload S3');

  // 8. Build viewer URL with k+n+id in fragment
  const k64 = base64UrlEncode(key);
  const n64 = base64UrlEncode(nonce);
  const shareUrl = `${SHARE_VIEWER_URL}/#k=${k64}&n=${n64}&b=${id}`;

  onProgress?.('Gata!', 100);
  return { shareUrl, shareId: id, expiresAt };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function getExt(filePath?: string): string {
  if (!filePath) return '';
  const m = filePath.match(/\.[a-z0-9]+$/i);
  return m ? m[0] : '';
}

function isImage(filePath?: string): boolean {
  return /\.(jpg|jpeg|png|webp|heic)$/i.test(filePath ?? '');
}

function filterDocsByConfig(docs: any[], config: ShareConfig): any[] {
  let filtered = docs;
  if (config.intervalMonths !== null) {
    const cutoff = Date.now() - config.intervalMonths * 30 * 24 * 3600 * 1000;
    filtered = filtered.filter(d => !d.issue_date || new Date(d.issue_date).getTime() >= cutoff);
  }
  if (config.docTypeFilter.length > 0) {
    filtered = filtered.filter(d => config.docTypeFilter.includes(d.type));
  }
  return filtered;
}

export async function revokeShare(shareId: string): Promise<void> {
  const res = await fetch(`${SHARE_RELAY_URL}/share/${shareId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    throw new Error('Eroare la revoke');
  }
}
```

- [ ] **Step 2: Type-check + audit**

```bash
npm run audit
```

- [ ] **Step 3: Commit**

```bash
git add services/medicalShare.ts
git commit -m "feat(share): bundle ZIP + AES-GCM encrypt + S3 upload via pre-signed URL"
```

---

### Task 17: `services/medicalShareHistory.ts`

**Files:**
- Create: `app/services/medicalShareHistory.ts`

- [ ] **Step 1: CRUD pe medical_shares**

```ts
import { db, generateId } from './db';
import { revokeShare } from './medicalShare';
import { emit } from './events';
import type { MedicalShare } from '@/types';

export async function insertShareRecord(record: {
  id: string;
  medical_record_id: string;
  expires_at: string;
  size_bytes: number;
  doc_count: number;
  obs_count: number;
}): Promise<void> {
  await db.runAsync(
    `INSERT INTO medical_shares
      (id, medical_record_id, created_at, expires_at, size_bytes, doc_count, obs_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.medical_record_id, new Date().toISOString(),
     record.expires_at, record.size_bytes, record.doc_count, record.obs_count]
  );
  emit('entities:changed');
}

export async function listSharesForRecord(recordId: string): Promise<MedicalShare[]> {
  return await db.getAllAsync<MedicalShare>(
    `SELECT * FROM medical_shares WHERE medical_record_id = ? ORDER BY created_at DESC`,
    [recordId]
  );
}

export async function revokeShareRecord(shareId: string): Promise<void> {
  await revokeShare(shareId);
  await db.runAsync(
    `UPDATE medical_shares SET revoked_at = ? WHERE id = ?`,
    [new Date().toISOString(), shareId]
  );
  emit('entities:changed');
}

export function getShareStatus(share: MedicalShare): 'active' | 'expired' | 'revoked' {
  if (share.revoked_at) return 'revoked';
  if (new Date(share.expires_at).getTime() < Date.now()) return 'expired';
  return 'active';
}
```

- [ ] **Step 2: Commit**

```bash
git add services/medicalShareHistory.ts
git commit -m "feat(share): CRUD + revoke for medical_shares table"
```

---

### Task 18: UI — sheet config + success modal + history list + buton detail

**Files:**
- Create: `app/components/medical/ShareDoctorSheet.tsx`
- Create: `app/components/medical/ShareSuccessModal.tsx`
- Create: `app/components/medical/ShareHistoryList.tsx`
- Create: `app/app/(tabs)/entitati/medical/[id]/share-history.tsx`
- Modify: `app/app/(tabs)/entitati/medical/[id]/index.tsx` (buton)
- Modify: `app/app/(tabs)/setari.tsx` (toggle betaShareEnabled)
- Modify: `app/services/settings.ts` (get/set BetaShareEnabled)

(Detalii UI; ~300-400 linii. Vezi spec §8.1-§8.3 pentru flow exact.)

- [ ] **Step 1-7: Implementare component-by-component**

Pentru fiecare component:
- Folosește `FormSheetModal` din `components/ui/FormSheetModal.tsx`
- Design tokens: `palette.card/text/border`, `primary`, `statusColors.*`
- `useColorScheme` din `@/components/useColorScheme`
- Loading/error pattern per Dosar hooks
- Feature flag `betaShareEnabled` din `services/settings.ts` ascunde butonul

- [ ] **Step 8: `npm run audit` verde**

- [ ] **Step 9: Commit**

```bash
git add app/ components/ services/
git commit -m "feat(share): UI — sheet config + success modal + history + feature flag"
```

---

## Faza F8d: Deploy + smoke test

### Task 19: Decizia provider Storage + deschidere cont

**În acest task se decide între Danubedata și Scaleway.**

- [ ] **Step 1: Verifică pricing curent ambele provideri**

- [ ] **Step 2: Decizie:**
  - Danubedata: deschide cont la `danubedata.ro` + cumpără Object Storage 1TB plan + Rapids
  - Scaleway: deschide cont la `console.scaleway.com` + creează Object Storage bucket free tier + folosește Rapids Danubedata în continuare
  - **Ambele:** semnează DPA, configurează billing

- [ ] **Step 3: Crează bucket `dosar-shares`**

Pentru ambele: bucket privat, lifecycle rule "delete after 24h" pe toate obiectele.

- [ ] **Step 4: Generează S3 access keys** (read+write doar pe bucket-ul `dosar-shares`)

- [ ] **Step 5: Documentează decizia într-un commit**

```bash
echo "Storage: <Danubedata | Scaleway>" >> docs/DEPLOYMENT.md
git add docs/DEPLOYMENT.md
git commit -m "docs(deployment): record storage provider decision for share feature"
```

---

### Task 20: Deploy relay la Rapids

- [ ] **Step 1: Build Docker image**

```bash
cd cloud/share-relay
docker build -t dosar-share-relay:latest .
```

- [ ] **Step 2: Push la Container Registry Danubedata**

```bash
docker tag dosar-share-relay:latest cr.danubedata.ro/<user>/dosar-share-relay:latest
docker push cr.danubedata.ro/<user>/dosar-share-relay:latest
```

- [ ] **Step 3: Deploy în Rapids dashboard**

- Pull image din CR
- Set env vars (S3_*, RATE_LIMIT_*, SHARE_TTL_*)
- Set resource profile: Micro
- Atașează default domain `dosar-share-relay.serverless.danubedata.ro`

- [ ] **Step 4: Verifică health**

```bash
curl https://dosar-share-relay.serverless.danubedata.ro/health
# expect: {"status":"ok","timestamp":"..."}
```

- [ ] **Step 5: Update `services/medicalShareConfig.ts` cu URL real**

```ts
export const SHARE_RELAY_URL = 'https://dosar-share-relay.serverless.danubedata.ro';
```

- [ ] **Step 6: Commit**

```bash
git add services/medicalShareConfig.ts
git commit -m "deploy(share): relay live at dosar-share-relay.serverless.danubedata.ro"
```

---

### Task 21: Deploy viewer la GitHub Pages

- [ ] **Step 1: Build viewer**

```bash
cd cloud/share-viewer
VITE_RELAY_URL=https://dosar-share-relay.serverless.danubedata.ro npm run build
```

- [ ] **Step 2: Deploy la `tudorAbrudan/tudorAbrudan.github.io` repo, sub-path `/dosar-share/`**

```bash
# Folosește gh-pages package sau git subtree
npx gh-pages -d dist -b main -r https://github.com/tudorAbrudan/tudorAbrudan.github.io.git \
  -e dosar-share
```

- [ ] **Step 3: Verifică URL accesibil**

Browser: `https://tudorabrudan.github.io/dosar-share/` — ar trebui să apară "Link invalid" (fragment gol).

- [ ] **Step 4: Commit (în repo principal Dosar)**

```bash
git commit --allow-empty -m "deploy(share-viewer): live at tudorabrudan.github.io/dosar-share"
```

---

### Task 22: Smoke test end-to-end pe device fizic

- [ ] **Step 1: Activează feature flag**

În app pe device: Setări → Beta features → "Partajare cu medic (beta)" ON.

- [ ] **Step 2: Generează un share**

Detaliu dosar medical → 🔗 Partajează → toate ON, interval "Ultimele 6 luni" → Generează → modal succes cu link.

- [ ] **Step 3: Verifică DB**

În app: ecran istoric share-uri → un item activ cu detalii.

- [ ] **Step 4: Verifică S3 dashboard**

În Danubedata/Scaleway dashboard: bucket `dosar-shares` are un obiect nou.

- [ ] **Step 5: Trimite link la propriul email/WA și deschide pe alt device**

- [ ] **Step 6: Browser deschide link → viewer:**
  - Header cu numele pacientului + countdown live
  - Tab Timeline cu observații + sparkline
  - Tab Documente cu thumbnails
  - Tap pe document → modal PDF/imagine se deschide

- [ ] **Step 7: Revoke manual**

În app: istoric → tap "Revoke" pe share-ul activ.

- [ ] **Step 8: Refresh viewer**

Browser-ul ar trebui acum să arate "Linkul a fost revocat de pacient".

- [ ] **Step 9: Verifică S3 — blob șters**

- [ ] **Step 10: Commit notes**

```bash
git commit --allow-empty -m "test(share): end-to-end smoke test passed on physical device + browser"
```

---

## Faza F8e: Privacy policy + release

### Task 23: Update privacy policy

- [ ] **Step 1: Update `docs/privacy.html`** cu paragraful din spec §10

- [ ] **Step 2: Update Setări → Despre → Privacy policy** din app (același text)

- [ ] **Step 3: Update App Privacy labels în App Store Connect**

Adaugă: Health Data → Used for app functionality → Linked to user (encrypted) → Not used for tracking.

- [ ] **Step 4: Commit**

```bash
git add docs/privacy.html app/
git commit -m "docs(privacy): update for doctor share feature + Danubedata/Scaleway sub-processor"
```

---

### Task 24: Release 3.7.0

- [ ] **Step 1: Bump version**

```
app.json:        "version": "3.7.0", "buildNumber": "58"
ios/Info.plist:  CFBundleShortVersionString=3.7.0, CFBundleVersion=58
```

- [ ] **Step 2: CHANGELOG**

```markdown
## [3.7.0] (2026-06-...) — build 58

### Adăugat
- Partajare dosar medical cu medic prin link 1h criptat end-to-end.
- Buton 🔗 "Partajează cu medicul" în detaliul dosarului (gating-uit prin feature flag beta).
- Ecran istoric share-uri cu posibilitate de revoke manual.

### Schimbat
- Privacy policy actualizat cu mențiune Danubedata/Scaleway ca sub-processor pentru găzduirea temporară de blob-uri criptate.
```

- [ ] **Step 3: Commit + Archive în Xcode + Upload App Store**

```bash
git add app.json CHANGELOG.md
git commit -m "release(3.7.0-58): doctor share feature (beta-flagged)"
git push origin main
```

---

## Note de execuție

### Ordinea de implementare

- **F8a (Task 1-7) independent** — relay poate fi dezvoltat fără context app
- **F8b (Task 8-14) independent** — viewer poate fi dezvoltat cu mock data, fără relay live
- **F8c (Task 15-18) depinde de F8a + F8b** pentru a ști URL-uri și schema bundle
- **F8d (Task 19-22) după F8a+F8b+F8c** — deploy + test
- **F8e (Task 23-24) ultimul** — privacy + release

### Frequent commits

Fiecare task se termină cu un commit dedicat. Hook-ul pre-commit din Dosar nu rulează pentru codul din `cloud/` (în afara folder-ului `app/`) — deci validarea pentru relay + viewer e prin propriile teste vitest.

### Worktree opțional

Pentru a izola lucrul F8 față de main, poți folosi:

```bash
cd /Users/ax/work/documents/app
git worktree add .worktrees/doctor-share -b feat/doctor-share
```

### Storage provider — decizie tardivă

Toată implementarea F8a+F8b+F8c e provider-agnostic. Decizia se ia în Task 19, când deschizi contul. Migrarea ulterioară între Danubedata și Scaleway = update env vars în Rapids + bucket copy = ~30 min.

### Dacă apare un blocker

Oprește implementarea, raportează problema, propune 2-3 soluții. NU forța deploy fără testare local prealabilă. NU comite chei S3 în repo (`.env` în `.gitignore`).
