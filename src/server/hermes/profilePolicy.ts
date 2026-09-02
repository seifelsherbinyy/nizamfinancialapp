/**
 * NIZAM Hermes profile policy.
 * Owning authority: PFOS Contract 12 and Contract 13, money rules, and the two-agent deployment plan.
 * Phase: Phase 2.5 refined Hermes integration.
 * Depends on: ../../features/routing/modelPolicy and ./knowledgeBoundary.
 * This file contains no credentials, endpoints, hostnames, store paths, or provider caps.
 */
import {
  MODEL_GLM,
  MODEL_MIMO,
  type Tier,
} from '../../features/routing/modelPolicy.ts';
import type { SpendAgent } from '../../features/routing/spendLedger.ts';
import type { KnowledgeDomain } from './knowledgeBoundary.ts';

export const HERMES_PROFILE_NAMES = ['nizam', 'pfos'] as const;
export type HermesProfileName = (typeof HERMES_PROFILE_NAMES)[number];

export interface HermesProfilePolicy {
  readonly profile: HermesProfileName;
  /** Hermes is an execution boundary; governance remains outside the profile runtime. */
  readonly executionOnly: true;
  readonly signalProducer: SpendAgent;
  readonly telegramTokenEntry: 'BOT_A_TOKEN' | 'BOT_B_TOKEN';
  readonly openRouterKeyEntry: 'OR_KEY_LIFE' | 'OR_KEY_FINANCE';
  readonly weeklyCapEntry: 'LIFE_WEEKLY_CAP' | 'FINANCE_WEEKLY_CAP';
  readonly storeEntry: 'LIFE_DATA_DIR' | 'FINANCE_DATA_DIR';
  readonly allowedDomains: readonly KnowledgeDomain[];
  readonly modelPolicy: Readonly<Record<Exclude<Tier, 'T0'>, string>>;
}

const NIZAM_MODEL_POLICY = {
  T1: MODEL_MIMO,
  T2: MODEL_GLM,
  T3: MODEL_GLM,
  T4: MODEL_GLM,
} as const satisfies Readonly<Record<Exclude<Tier, 'T0'>, string>>;

const PFOS_MODEL_POLICY = {
  T1: MODEL_GLM,
  T2: MODEL_GLM,
  T3: MODEL_GLM,
  T4: MODEL_GLM,
} as const satisfies Readonly<Record<Exclude<Tier, 'T0'>, string>>;

export const HERMES_PROFILE_POLICIES: Readonly<Record<HermesProfileName, HermesProfilePolicy>> = {
  nizam: {
    profile: 'nizam',
    executionOnly: true,
    signalProducer: 'life',
    telegramTokenEntry: 'BOT_A_TOKEN',
    openRouterKeyEntry: 'OR_KEY_LIFE',
    weeklyCapEntry: 'LIFE_WEEKLY_CAP',
    storeEntry: 'LIFE_DATA_DIR',
    allowedDomains: ['contract', 'financial', 'journal', 'health', 'operational', 'persona', 'goal', 'life_context', 'transaction', 'statement'],
    modelPolicy: NIZAM_MODEL_POLICY,
  },
  pfos: {
    profile: 'pfos',
    executionOnly: true,
    signalProducer: 'finance',
    telegramTokenEntry: 'BOT_B_TOKEN',
    openRouterKeyEntry: 'OR_KEY_FINANCE',
    weeklyCapEntry: 'FINANCE_WEEKLY_CAP',
    storeEntry: 'FINANCE_DATA_DIR',
    allowedDomains: ['contract', 'financial', 'operational', 'transaction', 'statement'],
    modelPolicy: PFOS_MODEL_POLICY,
  },
};

export function modelForTier(profile: HermesProfileName, tier: Tier): string | null {
  if (tier === 'T0') return null;
  return HERMES_PROFILE_POLICIES[profile].modelPolicy[tier];
}

export function getHermesProfilePolicy(profile: HermesProfileName): HermesProfilePolicy {
  return HERMES_PROFILE_POLICIES[profile];
}

export function assertProfileIsolation(left: HermesProfilePolicy, right: HermesProfilePolicy): void {
  const distinct = [
    left.telegramTokenEntry !== right.telegramTokenEntry,
    left.openRouterKeyEntry !== right.openRouterKeyEntry,
    left.weeklyCapEntry !== right.weeklyCapEntry,
    left.storeEntry !== right.storeEntry,
  ];
  if (distinct.every(Boolean)) return;
  throw new Error('HERMES_PROFILE_ISOLATION_FAILED');
}
