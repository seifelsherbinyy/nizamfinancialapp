/**
 * NIZAM - PFOS benchmark harness (M2): pricing snapshot + staleness + a live-fetch port.
 * Owning contract: PFOS contract 09 (OpenRouter Phase 1 - Benchmark Calibration): pricing is
 *   frozen for reproducibility; a live source may refresh it weekly, marked stale after the TTL.
 * Build phase: PFOS Stage 7, phase 7.1 - benchmark harness (offline, no network, no key).
 * Depends on: nothing.
 *
 * OFFLINE ONLY. The frozen snapshot below IS the Phase-1 table. `PricingSource` is a port a live
 * fetcher (module M1, server-tier) would implement; this harness NEVER calls it. USD prices use
 * `*UsdPerMillion` field names (never a money-named field) per the money-core convention.
 */

/** Per-model USD prices, quoted per one million tokens. cacheWrite null => fall back to prompt. */
export interface ModelPrice {
  model: string;
  promptUsdPerMillion: number;
  completionUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion: number | null;
}

/** ISO date the frozen table was captured. */
export const PRICING_SNAPSHOT_ISO = '2026-08-06';
/** Contract 09: refresh weekly; a snapshot older than this many days is stale. */
export const PRICING_TTL_DAYS = 7;

/** The Phase-1 frozen pricing table (the four rostered models). */
export const FROZEN_PRICING: Record<string, ModelPrice> = {
  'xiaomi/mimo-v2.5': {
    model: 'xiaomi/mimo-v2.5',
    promptUsdPerMillion: 0.112,
    completionUsdPerMillion: 0.224,
    cacheReadUsdPerMillion: 0.0024,
    cacheWriteUsdPerMillion: null,
  },
  'z-ai/glm-5.2': {
    model: 'z-ai/glm-5.2',
    promptUsdPerMillion: 0.28,
    completionUsdPerMillion: 0.88,
    cacheReadUsdPerMillion: 0.052,
    cacheWriteUsdPerMillion: null,
  },
  'x-ai/grok-4.5': {
    model: 'x-ai/grok-4.5',
    promptUsdPerMillion: 2.0,
    completionUsdPerMillion: 6.0,
    cacheReadUsdPerMillion: 0.3,
    cacheWriteUsdPerMillion: null,
  },
  'moonshotai/kimi-k3': {
    model: 'moonshotai/kimi-k3',
    promptUsdPerMillion: 2.9,
    completionUsdPerMillion: 14.0,
    cacheReadUsdPerMillion: 0.29,
    cacheWriteUsdPerMillion: null,
  },
};

export interface PricingSnapshot {
  capturedIso: string;
  source: 'frozen' | 'live';
  prices: Record<string, ModelPrice>;
}

/** The deterministic frozen snapshot. */
export function frozenSnapshot(): PricingSnapshot {
  return { capturedIso: PRICING_SNAPSHOT_ISO, source: 'frozen', prices: FROZEN_PRICING };
}

/**
 * A live pricing source (implemented by the server-tier pricing service, module M1). The harness
 * accepts an already-fetched snapshot via `loadPricing`; it never invokes `fetch` itself.
 */
export interface PricingSource {
  fetch(): Promise<PricingSnapshot>;
}

/** Whole days between two ISO dates (floored via ms difference). */
export function ageDays(capturedIso: string, nowIso: string): number {
  const ms = Date.parse(nowIso) - Date.parse(capturedIso);
  return ms / 86_400_000;
}

/** True when the snapshot is older than the TTL and should be refreshed before trusting. */
export function isStale(snap: PricingSnapshot, nowIso: string, ttlDays = PRICING_TTL_DAYS): boolean {
  return ageDays(snap.capturedIso, nowIso) > ttlDays;
}

/**
 * Resolve the pricing snapshot to use. Deterministic and I/O-free: if an already-fetched snapshot
 * is injected it is used (and staleness computed); otherwise the frozen table is returned.
 */
export function loadPricing(opts?: {
  nowIso?: string;
  injected?: PricingSnapshot;
}): { snapshot: PricingSnapshot; stale: boolean } {
  const snapshot = opts?.injected ?? frozenSnapshot();
  const nowIso = opts?.nowIso ?? snapshot.capturedIso;
  return { snapshot, stale: isStale(snapshot, nowIso) };
}

/** Look up a model's price in a snapshot; throws if the model is not present (never guesses). */
export function priceFor(snap: PricingSnapshot, model: string): ModelPrice {
  const p = snap.prices[model];
  if (!p) throw new Error(`no pricing for model "${model}" in snapshot ${snap.capturedIso}`);
  return p;
}
