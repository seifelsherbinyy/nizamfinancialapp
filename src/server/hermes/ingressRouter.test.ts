/**
 * Deterministic single-window ingress router tests.
 * Owning authority: PFOS Contract 14; Contracts 06, 12, and 13; money rules.
 * Phase 14 — single-window Slack ingress surface; Stage 2
 * Depends on: ingressRouter.ts and toolBoundary.ts.
 */
import { describe, expect, it } from 'vitest';
import { assertRoutedFinancialResult, routeIngressText } from './ingressRouter.ts';
import type { FinancialAnalysisResult } from './toolBoundary.ts';

const PFOS_RESULT: FinancialAnalysisResult = {
  resultRef: 'synthetic-result',
  facts: [
    {
      factRef: 'synthetic-fact',
      label: 'Synthetic snapshot',
      amountMilliunits: 2500,
      currency: 'EGP',
      computedAt: '2026-08-24T12:00:00Z',
      deterministicEngine: true,
    },
  ],
  explanation: 'Synthetic deterministic result.',
  deterministicEngine: true,
};

describe('single-window ingress router', () => {
  it('routes journal capture to the NIZAMCORE journal tool', () => {
    const routed = routeIngressText('capture this journal dump before I forget');
    expect(routed).toMatchObject({
      code: 'ROUTED',
      module: 'yawmiyat',
      profile: 'nizam',
      tool: 'nizamcore.append_journal_entry',
      effect: 'local_write',
    });
  });

  it('routes a balance question to PFOS and accepts only deterministic milliunits', () => {
    const routed = routeIngressText('what is my balance');
    expect(routed).toMatchObject({
      code: 'ROUTED',
      module: 'mal',
      profile: 'pfos',
      tool: 'pfos.read_financial_snapshot',
      effect: 'pfos_read',
    });
    expect(() => assertRoutedFinancialResult(routed, PFOS_RESULT)).not.toThrow();
    expect(() =>
      assertRoutedFinancialResult(routed, { ...PFOS_RESULT, deterministicEngine: false } as unknown as FinancialAnalysisResult),
    ).toThrow('PFOS_RESULT_NOT_DETERMINISTIC');
  });

  it('keeps mixed anxiety-plus-bill text on the PFOS number path', () => {
    const routed = routeIngressText('I am anxious about the card bill and also want this journaled');
    expect(routed.module).toBe('mal');
    expect(routed.profile).toBe('pfos');
    expect(routed.effect).toBe('pfos_read');
  });

  it('routes planning and critique without touching PFOS tools', () => {
    expect(routeIngressText('brainstorm options for the week').module).toBe('shura');
    expect(routeIngressText('red-team this plan').module).toBe('naqd');
    expect(routeIngressText('close the loop for thabat').tool).toBe('signalbus.read_bounded_signals');
  });

  it('refuses secret-seeking and unknown host writes with zero effect', () => {
    const secret = routeIngressText('what is the OpenRouter api key');
    expect(secret).toMatchObject({ code: 'REFUSED_SECRET', effect: 'none', tool: null });
    const write = routeIngressText('deploy the host and rotate dns');
    expect(write).toMatchObject({ code: 'REFUSED_UNKNOWN_WRITE', effect: 'none', tool: null });
  });

  it('asks one clarifying question instead of guessing', () => {
    const routed = routeIngressText('help');
    expect(routed.code).toBe('CLARIFY');
    expect(routed.effect).toBe('none');
    expect(routed.tool).toBeNull();
  });
});
