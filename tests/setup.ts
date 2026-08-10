/**
 * NIZAM · Vitest setup (jsdom, testing-library)
 * Implemented by: KIRO Contract 1 / Phase 1.2
 * Depends on: none
 *
 * ## Why the two imports below are conditional
 *
 * `setupFiles` runs for EVERY test file, and this repository's test tree is now mostly the server
 * tier: around sixty files declare `@vitest-environment node` and have no DOM at all. Loading
 * `@testing-library/jest-dom/vitest` and `@testing-library/react` into those files costs the
 * module graph of the whole browser testing stack per file and buys nothing — there is no document
 * to match against and no component to clean up.
 *
 * So the guard is on `window`, which is the fact that decides it: jsdom defines it, the node
 * environment does not. Under jsdom both imports load and `cleanup` is registered exactly as
 * before, so no browser test changes. Under node both are skipped.
 *
 * The imports are dynamic because a static `import` is hoisted and evaluated before any condition
 * could apply — the cost is in the module evaluation, so it is the evaluation that has to be
 * conditional rather than the use.
 */
import { afterEach } from 'vitest';

if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');

  afterEach(() => {
    cleanup();
  });
}
