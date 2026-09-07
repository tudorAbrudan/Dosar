# dosar-ai-proxy

Proxy OpenAI-compatible între aplicația Dosar și Mistral. Ține cheia API pe
server, nu în bundle-ul din App Store.

**De ce există:** `EXPO_PUBLIC_MISTRAL_API_KEY` ajunge compilat în binarul
publicat, deci oricine îl decompilează are cheia și cotă nelimitată pe contul
tău. Proxy-ul mută cheia pe server; aplicația primește doar un URL.

## Ce face

Un singur endpoint: `POST /v1/chat/completions`, compatibil OpenAI — aceeași
formă pe care `services/aiProvider.ts` o trimite deja către Mistral.

| Protecție | Unde | Ce oprește |
|---|---|---|
| Cheia doar în env server | `config.js` | extragerea cheii din bundle |
| Whitelist de modele | `validate.js` | rularea de modele scumpe pe contul tău |
| Payload reconstruit, nu releat | `validate.js` | parametri strecurați (`n`, `tools`, `stream`) |
| Plafon `max_tokens` | `validate.js` | cereri uriașe |
| Limită/zi per device + globală | `limits.js` | abuz repetat |
| Token de aplicație | `server.js` | `curl` trivial pe URL-ul găsit |
| Timeout + 502/504 curate | `server.js` | cereri agățate |

**Nu logăm prompturi, mesaje sau răspunsuri.** Prin serviciu trec date
personale și medicale. Logurile conțin doar model, status și durată.

## Limitele oneste ale acestui design

1. **Token-ul de aplicație e obfuscare, nu securitate.** Ajunge în bundle, deci
   poate fi extras exact ca și cheia. Ce câștigi real: atacatorul nu-ți poate
   folosi contul Mistral în altă parte, e închis în whitelist-ul de modele, iar
   tu poți tăia accesul din env fără release în App Store. Închiderea completă
   cere **App Attest** (iOS) — device-ul semnează o atestare pe care serverul o
   verifică. E un proiect separat.
2. **Contoarele sunt în memorie și Rapids e scale-to-zero.** Când containerul
   doarme, contoarele se pierd. Filtrează abuzul obișnuit, nu unul răbdător.
   Dacă devine o problemă: Valkey (Danube, ~6,49€/lună), aceeași interfață în
   `limits.js`.
3. **Stopul real rămâne plafonul de cheltuială din contul Mistral.** Setează-l
   înainte de orice altceva. Toate cele de mai sus reduc probabilitatea; doar
   plafonul mărginește paguba.

## Rulare locală

```bash
cp .env.example .env    # completează MISTRAL_API_KEY și PROXY_APP_TOKEN
npm test                # 11 teste, fără rețea (Mistral e mock-uit)
node --env-file=.env server.js
```

Verificare rapidă pe instanța locală:

```bash
curl -s localhost:8080/health

curl -s localhost:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "X-Dosar-Key: $PROXY_APP_TOKEN" \
  -H 'X-Dosar-Device: test-device-0001' \
  -d '{"model":"mistral-small-latest","messages":[{"role":"user","content":"salut"}],"max_tokens":20}'
```

## Deploy pe Danube Rapids (free tier)

Free tier: 2M requests, ~69 vCPU-ore, 139 GiB-ore pe lună. Un proxy care doar
releează un fetch stă confortabil înăuntru.

```bash
npm install -g @danubedata/cli
danube login

# din folderul app/ai-proxy/
danube rapids create        # apoi: danube rapids deploy
```

CLI-ul împachetează folderul respectând `.gitignore` și exclude oricum
`node_modules/` și `.git/`. Există și `danube rapids apply --name api --wait --json`
pentru flux neinteractiv (CI), plus deploy din repo Git cu build la fiecare push.

**Variabilele de mediu de setat pe container** (`MISTRAL_API_KEY` ca *secret*,
restul simple):

```
MISTRAL_API_KEY=<cheia rotită, nu cea veche din bundle>
PROXY_APP_TOKEN=<openssl rand -hex 24>
PER_DEVICE_DAILY_LIMIT=10
GLOBAL_DAILY_LIMIT=5000
```

> Flag-ul exact pentru env/secrets nu e documentat public la data scrierii —
> ia-l din `danube rapids create --help` sau setează-le din dashboard. Verifică
> înainte de deploy că secretele sunt marcate ca secrete (nu apar în loguri).

După deploy primești un subdomeniu `*.serverless.danubedata.ro` cu TLS
automat. Rulează `curl` de mai sus pe el înainte de a atinge aplicația.

## Wiring în aplicație

În `app/services/aiProvider.ts`, provider-ul `builtin` are nevoie de trei
schimbări:

```diff
-const BUILTIN_API_KEY = process.env.EXPO_PUBLIC_MISTRAL_API_KEY ?? '';
-const BUILTIN_URL = 'https://api.mistral.ai/v1';
+const BUILTIN_API_KEY = process.env.EXPO_PUBLIC_DOSAR_AI_TOKEN ?? '';
+const BUILTIN_URL = process.env.EXPO_PUBLIC_DOSAR_AI_URL ?? '';
```

Endpoint-ul acceptă token-ul **și** ca `Authorization: Bearer <token>`? Nu — îl
citește din `X-Dosar-Key`. Deci `sendAiRequest` și `sendAiRequestWithImage`
trebuie să adauge header-ul (și, ideal, `X-Dosar-Device` cu un id anonim stabil,
altfel contorizarea cade pe IP, care pe mobil e partajat prin CGNAT).

Restul rămâne neatins: forma cererii e identică, modelele sunt aceleași, iar
429-ul proxy-ului declanșează exact mesajul `AI_UNLIMITED_HINT` pe care
aplicația îl afișează deja.

După wiring, `EXPO_PUBLIC_MISTRAL_API_KEY` poate fi scos din `.env` și din
allowlist-ul `scripts/expo-public-secrets-audit.js`.

## Ordinea recomandată

1. Plafon de cheltuială în contul Mistral — acum, 5 minute.
2. Deploy proxy + `curl` de verificare.
3. Wiring în aplicație, cheie Mistral **rotită**, release.
4. Revocă cheia veche abia după ce noul build e live (cea veche mai deservește
   userii pe versiuni vechi).
