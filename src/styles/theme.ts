/**
 * NIZAM · YNAB-inspired design tokens (colors, spacing, RAG)
 * Implemented by: KIRO Contract 4 / Phase 4.1
 * Depends on: none
 *
 * Single source for tokens used from TS; globals.css mirrors them as CSS variables.
 */

export const colors = {
  // Chrome
  sidebarBg: '#26315f',
  sidebarBgHover: '#32407a',
  sidebarText: '#e7eaf6',
  sidebarMuted: '#9aa3c7',
  contentBg: '#f6f7f9',
  surface: '#ffffff',
  border: '#dde1e7',
  text: '#1f2430',
  textMuted: '#68707f',
  accent: '#3a5bdc',
  accentText: '#ffffff',

  // RAG (money states)
  ragGreenBg: '#d8f0e0',
  ragGreenText: '#14663c',
  ragAmberBg: '#fdeeca',
  ragAmberText: '#8a6100',
  ragRedBg: '#fbdcda',
  ragRedText: '#a52a1e',
  ragNeutralBg: '#eceef1',
  ragNeutralText: '#68707f',
} as const;

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
} as const;

export const font = {
  family:
    "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'",
  sizeSm: '12.5px',
  sizeMd: '14px',
  sizeLg: '17px',
  sizeXl: '22px',
  mono: "Consolas, 'SF Mono', Menlo, monospace",
} as const;

export type RagState = 'positive' | 'zero' | 'warning' | 'negative';

/** RAG state of an Available amount (YNAB semantics). */
export function ragForAvailable(milliunits: number): RagState {
  if (milliunits > 0) return 'positive';
  if (milliunits === 0) return 'zero';
  return 'negative';
}

/** RAG state for Ready-To-Assign (amber when money is waiting to be assigned? no — green when 0 is the YNAB goal is zero-based: green when 0, amber when positive/unassigned, red negative). */
export function ragForRta(milliunits: number): RagState {
  if (milliunits === 0) return 'positive';
  if (milliunits > 0) return 'warning';
  return 'negative';
}
