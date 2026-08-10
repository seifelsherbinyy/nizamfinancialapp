// @vitest-environment node
/**
 * NIZAM - PFOS model-selection + budget policy tests.
 * Owning contract: PFOS contract 10 (OpenRouter Phase 2 - routing) + contract 11 (Phase 3 - budget).
 * Build phase: PFOS Stage 7, phase 7.2 - offline model-selection policy.
 * Depends on: modelPolicy.
 */
import { describe, it, expect } from 'vitest';
import {
  selectModel,
  budgetPhase,
  estTurnCostUsd,
  WEEKLY_BUDGET_USD,
  MODEL_MIMO,
  MODEL_GLM,
  MODEL_GROK,
  MODEL_KIMI,
} from './modelPolicy.ts';

describe('budgetPhase (weekly USD 5 cap)', () => {
  it('maps spend fractions to governance phases', () => {
    expect(budgetPhase(0)).toBe('ok');
    expect(budgetPhase(3.5)).toBe('warn'); // 70%
    expect(budgetPhase(4.25)).toBe('restrict'); // 85%
    expect(budgetPhase(4.75)).toBe('critical'); // 95%
    expect(budgetPhase(5)).toBe('exhausted');
    expect(budgetPhase(6)).toBe('exhausted');
  });
});

describe('selectModel - default policy {mimo, glm}, cheapest capable', () => {
  it('T0 needs no model', () => {
    const r = selectModel({ tier: 'T0', spentThisWeekUsd: 0 });
    expect(r.model).toBeNull();
    expect(r.blockedByBudget).toBe(false);
  });

  it('T1 picks the cheapest capable model (MiMo)', () => {
    const r = selectModel({ tier: 'T1', spentThisWeekUsd: 0 });
    expect(r.model).toBe(MODEL_MIMO);
    expect(r.premiumUsed).toBe(false);
  });

  it('T2 picks GLM (MiMo is not capable at T2)', () => {
    const r = selectModel({ tier: 'T2', spentThisWeekUsd: 0 });
    expect(r.model).toBe(MODEL_GLM);
  });

  it('T3 defaults to GLM and flags the missing independent reviewer', () => {
    const r = selectModel({ tier: 'T3', spentThisWeekUsd: 0 });
    expect(r.model).toBe(MODEL_GLM);
    expect(r.premiumUsed).toBe(false);
    expect(r.notes.join(' ')).toContain('independent reviewer');
  });

  it('T4 defaults to GLM (Kimi is off by default)', () => {
    const r = selectModel({ tier: 'T4', spentThisWeekUsd: 0 });
    expect(r.model).toBe(MODEL_GLM);
  });

  it('never selects a premium model without an opt-in', () => {
    for (const tier of ['T1', 'T2', 'T3', 'T4'] as const) {
      const r = selectModel({ tier, spentThisWeekUsd: 0 });
      expect([MODEL_GROK, MODEL_KIMI]).not.toContain(r.model);
    }
  });
});

describe('selectModel - premium opt-in for ultra-complex tasks', () => {
  it('T3 opt-in restores the Grok independent reviewer', () => {
    const r = selectModel({ tier: 'T3', allowPremium: true, spentThisWeekUsd: 0 });
    expect(r.model).toBe(MODEL_GROK);
    expect(r.premiumUsed).toBe(true);
  });

  it('T4 opt-in uses Kimi', () => {
    const r = selectModel({ tier: 'T4', allowPremium: true, spentThisWeekUsd: 0 });
    expect(r.model).toBe(MODEL_KIMI);
    expect(r.premiumUsed).toBe(true);
  });

  it('T1 opt-in has no premium benefit and stays on the default cheapest', () => {
    const r = selectModel({ tier: 'T1', allowPremium: true, spentThisWeekUsd: 0 });
    expect(r.model).toBe(MODEL_MIMO);
    expect(r.premiumUsed).toBe(false);
  });
});

describe('selectModel - hard weekly budget', () => {
  it('blocks all LLM routing once the weekly cap is exhausted', () => {
    const r = selectModel({ tier: 'T1', spentThisWeekUsd: WEEKLY_BUDGET_USD });
    expect(r.model).toBeNull();
    expect(r.blockedByBudget).toBe(true);
    expect(r.budgetPhase).toBe('exhausted');
  });

  it('holds premium back at >=95% of the cap even when opted in', () => {
    const r = selectModel({ tier: 'T3', allowPremium: true, spentThisWeekUsd: 4.8 });
    expect(r.budgetPhase).toBe('critical');
    expect(r.premiumUsed).toBe(false);
    expect(r.model).toBe(MODEL_GLM);
    expect(r.notes.join(' ')).toContain('held back');
  });

  it('falls back from an unaffordable premium pick to the default cheapest', () => {
    // A very large turn makes Grok exceed the whole budget while GLM still fits; spend low (phase ok).
    const bigTurn = { promptTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, completionTokens: 1_000_000, reasoningTokens: 0, costUsd: 0 };
    expect(estTurnCostUsd(MODEL_GROK, 'T3', bigTurn)).toBeGreaterThan(WEEKLY_BUDGET_USD);
    expect(estTurnCostUsd(MODEL_GLM, 'T3', bigTurn)).toBeLessThan(WEEKLY_BUDGET_USD);
    const r = selectModel({ tier: 'T3', allowPremium: true, spentThisWeekUsd: 0, estTurnUsage: bigTurn });
    expect(r.budgetPhase).toBe('ok');
    expect(r.model).toBe(MODEL_GLM);
    expect(r.premiumUsed).toBe(false);
    expect(r.notes.join(' ')).toContain('fell back');
  });

  it('blocks when even the cheapest capable model will not fit', () => {
    // A huge turn exceeds the whole budget for MiMo too; spend low so the phase is not exhausted.
    const hugeTurn = { promptTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, completionTokens: 30_000_000, reasoningTokens: 0, costUsd: 0 };
    expect(estTurnCostUsd(MODEL_MIMO, 'T1', hugeTurn)).toBeGreaterThan(WEEKLY_BUDGET_USD);
    const r = selectModel({ tier: 'T1', spentThisWeekUsd: 0, estTurnUsage: hugeTurn });
    expect(r.model).toBeNull();
    expect(r.blockedByBudget).toBe(true);
    expect(r.budgetPhase).toBe('ok');
  });
});
