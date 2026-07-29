/**
 * NIZAM · Context providers — store, drive-session, theme
 * Implemented by: KIRO Contract 1 / Phase 1.3 (minimal; extended in Contract 2 / Phase 2.4)
 * Depends on: none (Zustand store is hook-based, no provider needed)
 */
import type { ReactNode } from 'react';

/**
 * Zustand stores are consumed via hooks, so no React context is required today.
 * This component stays as the single mounting point for future cross-cutting
 * providers (drive session, theme) added by later contracts.
 */
export function AppProviders(props: { children: ReactNode }): ReactNode {
  return props.children;
}
