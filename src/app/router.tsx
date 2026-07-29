/**
 * NIZAM · Client router (budget / accounts / reports / import / reconcile)
 * Implemented by: KIRO Contract 1 / Phase 1.3 (routes stubbed; wired for real in Contract 4)
 * Depends on: none
 *
 * Design note: a tiny hash-based router keeps the app dependency-light and
 * works on any static host (GitHub Pages) with zero server rewrites.
 */
/* eslint-disable react-refresh/only-export-components -- router exports hooks + helpers by design */
import { useEffect, useState, type ReactNode } from 'react';

export type RoutePath = '/budget' | '/accounts' | '/reports' | '/import' | '/reconcile';

export const DEFAULT_ROUTE: RoutePath = '/budget';

export interface ParsedRoute {
  /** Normalized top-level path, e.g. '/accounts' */
  path: RoutePath;
  /** Optional route param, e.g. account id in '#/accounts/acc_123' */
  param: string | null;
}

/** Parse a location.hash value into a route. Unknown paths fall back to DEFAULT_ROUTE. */
export function parseHash(hash: string): ParsedRoute {
  const raw = hash.replace(/^#/, '') || DEFAULT_ROUTE;
  const segments = raw.split('/').filter(Boolean);
  const head = `/${segments[0] ?? ''}`;
  const known: RoutePath[] = ['/budget', '/accounts', '/reports', '/import', '/reconcile'];
  const path = (known as string[]).includes(head) ? (head as RoutePath) : DEFAULT_ROUTE;
  const param = segments[1] ?? null;
  return { path, param };
}

/** Imperative navigation helper. */
export function navigate(path: RoutePath, param?: string): void {
  window.location.hash = param ? `${path}/${param}` : path;
}

/** Subscribe to the current hash route. */
export function useHashRoute(): ParsedRoute {
  const [route, setRoute] = useState<ParsedRoute>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return route;
}

/** Route outlet — renders the view for the active route (stubs until Contract 4). */
export function RouterOutlet(props: { views: Record<RoutePath, ReactNode> }): ReactNode {
  const { path } = useHashRoute();
  return props.views[path];
}
