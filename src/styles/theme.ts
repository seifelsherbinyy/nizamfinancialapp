/**
 * NIZAM · Financial command-system design tokens
 * Implemented by: PFOS Contract 04 / Visual Upgrade Wave 1
 * Depends on: none
 *
 * Semantic tokens are the source of truth for UI meaning. Legacy aliases stay exported during
 * Wave 1 so existing screens keep working while the product layer migrates incrementally.
 */

export const colors = {
  background: '#f5f6f3',
  surface1: '#ffffff',
  surface2: '#f8f9f7',
  surface3: '#eef1ed',
  surfaceRaised: '#ffffff',
  overlay: 'rgba(12, 18, 30, 0.56)',

  foreground: '#17202b',
  foregroundMuted: '#667085',
  foregroundSubtle: '#8b95a5',

  border: '#dfe4df',
  borderStrong: '#c9d0ca',

  primary: '#3156d3',
  primaryHover: '#2848b5',
  primaryForeground: '#ffffff',

  positive: '#177245',
  positiveSurface: '#e5f3eb',
  warning: '#8a6100',
  warningSurface: '#fff1cf',
  negative: '#a33228',
  negativeSurface: '#fbe6e2',
  info: '#3156d3',
  infoSurface: '#e9eefc',
  focusRing: '#3156d3',

  navBackground: '#18233b',
  navSurface: '#22304f',
  navText: '#f3f5fb',
  navMuted: '#aeb8ce',

  chartActual: '#3156d3',
  chartForecast: '#7986a8',
  chartTarget: '#177245',
  chartRisk: '#a33228',

  // Legacy aliases retained until all screens migrate to semantic names.
  sidebarBg: '#18233b',
  sidebarBgHover: '#22304f',
  sidebarText: '#f3f5fb',
  sidebarMuted: '#aeb8ce',
  contentBg: '#f5f6f3',
  surface: '#ffffff',
  text: '#17202b',
  textMuted: '#667085',
  accent: '#3156d3',
  accentText: '#ffffff',
  ragGreenBg: '#e5f3eb',
  ragGreenText: '#177245',
  ragAmberBg: '#fff1cf',
  ragAmberText: '#8a6100',
  ragRedBg: '#fbe6e2',
  ragRedText: '#a33228',
  ragNeutralBg: '#eef1ed',
  ragNeutralText: '#667085',
} as const;

export const spacing = {
  xxs: '2px',
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
  xxxl: '48px',
} as const;

export const radius = {
  sm: '6px',
  md: '10px',
  lg: '16px',
  pill: '999px',
} as const;

export const font = {
  family:
    "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  sizeXs: '12px',
  sizeSm: '13px',
  sizeMd: '14px',
  sizeLg: '17px',
  sizeXl: '24px',
  size2xl: '32px',
  mono: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
} as const;

export const motion = {
  fast: '140ms',
  standard: '200ms',
  panel: '260ms',
  ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
} as const;

export type RagState = 'positive' | 'zero' | 'warning' | 'negative';

export function ragForAvailable(milliunits: number): RagState {
  if (milliunits > 0) return 'positive';
  if (milliunits === 0) return 'zero';
  return 'negative';
}

export function ragForRta(milliunits: number): RagState {
  if (milliunits === 0) return 'positive';
  if (milliunits > 0) return 'warning';
  return 'negative';
}
