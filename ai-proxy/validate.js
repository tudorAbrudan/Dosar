/**
 * Validare + construcția payload-ului trimis mai departe.
 *
 * Regula: NU releăm corpul primit. Construim unul nou, din câmpuri cunoscute.
 * Un pass-through ar lăsa clientul să strecoare orice parametru acceptă Mistral
 * (alt model prin alias, `n: 50`, `stream`, tool-uri) și ar face plafoanele
 * decorative.
 */

/**
 * @returns {{ ok: true, payload: object } | { ok: false, status: number, message: string }}
 */
export function buildUpstreamPayload(body, config) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, message: 'Corp invalid: se aștepta un obiect JSON.' };
  }

  const { model, messages, max_tokens: maxTokens, temperature } = body;

  if (typeof model !== 'string' || !model) {
    return { ok: false, status: 400, message: 'Câmpul „model" lipsește.' };
  }
  if (!config.allowedModels.has(model)) {
    return { ok: false, status: 403, message: `Model nepermis: ${model}` };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, status: 400, message: 'Câmpul „messages" lipsește sau e gol.' };
  }
  for (const m of messages) {
    if (typeof m !== 'object' || m === null || typeof m.role !== 'string') {
      return { ok: false, status: 400, message: 'Mesaj invalid în „messages".' };
    }
    if (typeof m.content !== 'string' && !Array.isArray(m.content)) {
      return { ok: false, status: 400, message: 'Conținut invalid într-un mesaj.' };
    }
  }

  // Plafonăm în loc să respingem: o cerere legitimă care cere prea mult trebuie
  // să reușească mai mic, nu să pice în fața userului.
  const cappedTokens = Math.min(
    Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : 500,
    config.maxTokensCap
  );

  // Whitelist-ul se aplică pe numele primit de la aplicație; traducerea spre
  // numele providerului se face DUPĂ, ca schimbarea de provider să nu deschidă
  // accidental modele neaprobate.
  const payload = {
    model: config.modelMap[model] ?? model,
    messages,
    max_tokens: cappedTokens,
    stream: false,
  };
  if (Number.isFinite(temperature) && temperature >= 0 && temperature <= 2) {
    payload.temperature = temperature;
  }
  if (config.reasoningEffort) {
    payload.reasoning_effort = config.reasoningEffort;
  }

  return { ok: true, payload };
}

/**
 * Identificator pentru contorizare. Preferăm header-ul trimis de aplicație
 * (anonim, generat pe device); altfel cădem pe IP, care pe mobil e adesea
 * partajat prin CGNAT — de aceea header-ul e varianta bună.
 */
export function deviceIdFrom(req) {
  const header = req.headers['x-dosar-device'];
  if (typeof header === 'string' && header.length >= 8 && header.length <= 128) {
    return `d:${header}`;
  }
  const fwd = req.headers['x-forwarded-for'];
  const ip = typeof fwd === 'string' ? fwd.split(',')[0].trim() : req.socket.remoteAddress;
  return `ip:${ip ?? 'unknown'}`;
}
