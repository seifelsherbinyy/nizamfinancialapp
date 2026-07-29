/**
 * NIZAM · Vitest setup (jsdom, testing-library)
 * Implemented by: KIRO Contract 1 / Phase 1.2
 * Depends on: none
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
