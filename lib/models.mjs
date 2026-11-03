// Pure functions that turn an OpenRouter model catalog into picker rows and
// a fallback chain. No I/O here, so every rule is unit-testable.

const FREE = '0';

export function isFreeModel(model) {
  const pricing = model?.pricing ?? {};
  return pricing.prompt === FREE && pricing.completion === FREE;
}

export function pricePerMillion(perToken) {
  const n = Number(perToken ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Number((n * 1e6).toFixed(4));
}

export function isExpired(model, now = Date.now()) {
  if (!model?.expiration_date) return false;
  const at = Date.parse(model.expiration_date);
  return Number.isFinite(at) && at <= now;
}

export function supportsParam(model, param) {
  return Array.isArray(model?.supported_parameters) && model.supported_parameters.includes(param);
}

export function supportsVision(model) {
  const modalities = model?.architecture?.input_modalities;
  return Array.isArray(modalities) && modalities.includes('image');
}

/** Cheap input-size estimate (4 chars per token) used to skip models that cannot fit. */
export function estimateTokens(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let chars = 0;
  for (const message of list) chars += String(message?.content ?? '').length;
  return Math.ceil(chars / 4) + list.length * 4;
}

export function toPickerModel(model) {
  return {
    id: model.id,
    name: model.name ?? model.id,
    vendor: String(model.id).split('/')[0],
    context: model.context_length ?? 0,
    maxOutput: model?.top_provider?.max_completion_tokens ?? null,
    inPrice: pricePerMillion(model?.pricing?.prompt),
    outPrice: pricePerMillion(model?.pricing?.completion),
    free: isFreeModel(model),
    tools: supportsParam(model, 'tools'),
    vision: supportsVision(model),
  };
}

export function filterModels(models, options = {}, now = Date.now()) {
  const {
    q = '',
    freeOnly = false,
    needTools = false,
    needVision = false,
    minContext = 0,
    includeExpired = false,
  } = options;
  const needle = String(q).trim().toLowerCase();

  return (Array.isArray(models) ? models : [])
    .filter((m) => includeExpired || !isExpired(m, now))
    .filter((m) => (freeOnly ? isFreeModel(m) : true))
    .filter((m) => (needTools ? supportsParam(m, 'tools') : true))
    .filter((m) => (needVision ? supportsVision(m) : true))
    .filter((m) => (m.context_length ?? 0) >= minContext)
    .filter((m) => {
      if (!needle) return true;
      return (
        String(m.id).toLowerCase().includes(needle) ||
        String(m.name ?? '').toLowerCase().includes(needle)
      );
    })
    .map(toPickerModel);
}

/**
 * Ordered list of model ids to send as OpenRouter's `models` fallback array.
 * Free-only unless `includePaid` is set, filtered by capability, then ranked:
 * tool-capable first, then larger context, then id for determinism.
 */
export function buildChain(models, options = {}, now = Date.now()) {
  const {
    primary = null,
    needTools = false,
    needVision = false,
    minContext = 0,
    limit = 4,
    exclude = [],
    includePaid = false,
  } = options;

  const skip = new Set(exclude);
  const usable = (Array.isArray(models) ? models : []).filter(
    (m) =>
      (includePaid || isFreeModel(m)) &&
      !isExpired(m, now) &&
      !skip.has(m.id) &&
      (m.context_length ?? 0) >= minContext &&
      (!needTools || supportsParam(m, 'tools')) &&
      (!needVision || supportsVision(m)),
  );

  usable.sort((a, b) => {
    // Free models always outrank paid ones; paid is a last resort only.
    const freeA = isFreeModel(a) ? 0 : 1;
    const freeB = isFreeModel(b) ? 0 : 1;
    if (freeA !== freeB) return freeA - freeB;
    const toolsA = supportsParam(a, 'tools') ? 0 : 1;
    const toolsB = supportsParam(b, 'tools') ? 0 : 1;
    if (toolsA !== toolsB) return toolsA - toolsB;
    const context = (b.context_length ?? 0) - (a.context_length ?? 0);
    if (context !== 0) return context;
    return String(a.id).localeCompare(String(b.id));
  });

  const known = new Set(usable.map((model) => model.id));
  const chain = [];
  // A requested model is only trusted if the catalog still lists it, so a stale
  // saved slug cannot be sent on every request.
  if (primary && known.has(primary)) chain.push(primary);
  for (const model of usable) {
    if (chain.length >= limit) break;
    if (!chain.includes(model.id)) chain.push(model.id);
  }
  return chain;
}

/** Best default model id for a fresh install. */
export function defaultModel(models, now = Date.now()) {
  const chain = buildChain(models, { limit: 1 }, now);
  return chain[0] ?? null;
}
