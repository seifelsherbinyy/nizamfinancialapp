// @vitest-environment node
/**
 * NIZAM · browser/server PFOS milliunit boundary parity tests
 * Owning contract: PFOS Contract 12; UPOI requirements 3.1–3.4; design §7.5, §11.1, §14.3
 * Phase: Phase 3.4 — UPOI task 3.4
 */
import { describe, expect, it } from 'vitest';
import {
  fromDecimalStrict,
  fromMilliunitsStrict,
  formatEGP,
  toDecimal,
} from './money.ts';
import fixture from '../../../tests/fixtures/pfos-money-boundary.json';

type BoundaryFixture = {
  safeEdges: { minimum: string; maximum: string };
  envelopeValues: Record<string, string>;
  envelope: string;
  signedFlows: Array<{
    amount: string;
    outflow: string;
    inflow: string;
    wire: string;
  }>;
  decimalCases: Array<{ text: string; milliunits: string; formatted: string }>;
  invalidMilliunitText: string[];
};

const boundary = fixture as BoundaryFixture;

describe('PFOS/browser milliunit boundary parity', () => {
  it('uses exactly 1000 milliunits for one EGP and preserves safe edges', () => {
    expect(fromMilliunitsStrict(boundary.envelopeValues.oneEgp ?? '')).toBe(1000);
    expect(fromMilliunitsStrict(boundary.safeEdges.minimum ?? '')).toBe(-Number.MAX_SAFE_INTEGER);
    expect(fromMilliunitsStrict(boundary.safeEdges.maximum ?? '')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('round-trips lossless decimal parsing and deterministic decimal formatting', () => {
    for (const testCase of boundary.decimalCases) {
      const value = fromDecimalStrict(testCase.text);
      expect(value).toBe(Number(testCase.milliunits));
      expect(toDecimal(value)).toBe(testCase.formatted);
    }
  });

  it('formats the same milliunit value deterministically without changing its stored value', () => {
    const oneEgp = fromMilliunitsStrict(boundary.envelopeValues.oneEgp ?? '');

    expect(formatEGP(oneEgp)).toBe(formatEGP(oneEgp));
    expect(toDecimal(oneEgp)).toBe('1.000');
  });

  it('matches the canonical server envelope using exact integer text values', () => {
    const parsedValues = Object.fromEntries(
      Object.entries(boundary.envelopeValues).map(([key, value]) => [key, fromMilliunitsStrict(value)]),
    );
    const browserWire = Object.fromEntries(
      Object.keys(parsedValues)
        .sort()
        .map((key) => [key, String(parsedValues[key])]),
    );

    expect(JSON.stringify(browserWire)).toBe(boundary.envelope);
    expect(JSON.parse(boundary.envelope)).toEqual(browserWire);
  });

  it('preserves signed-flow magnitude conventions in the browser fixture', () => {
    for (const flow of boundary.signedFlows) {
      const amount = fromMilliunitsStrict(flow.amount);
      const outflow = fromMilliunitsStrict(flow.outflow);
      const inflow = fromMilliunitsStrict(flow.inflow);

      if (amount < 0) {
        expect(outflow).toBe(-amount);
        expect(inflow).toBe(0);
      } else if (amount > 0) {
        expect(inflow).toBe(amount);
        expect(outflow).toBe(0);
      } else {
        expect(outflow).toBe(0);
        expect(inflow).toBe(0);
      }
      expect(JSON.parse(flow.wire)).toEqual({
        amount: String(amount),
        inflow: String(inflow),
        outflow: String(outflow),
      });
    }
  });

  it('rejects invalid milliunit text before calculation or persistence', () => {
    const calls: string[] = [];
    const calculateAndPersist = (raw: string): void => {
      const value = fromMilliunitsStrict(raw);
      calls.push(`calculate:${value}`);
      calls.push(`persist:${value}`);
    };

    for (const raw of boundary.invalidMilliunitText) {
      expect(() => calculateAndPersist(raw), raw).toThrow();
      expect(calls, raw).toEqual([]);
    }
  });
});
