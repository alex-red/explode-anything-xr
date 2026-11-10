import type { TruthStatus } from '@explode/contracts';

/** Color semantics (INTERACTION_SPEC): every state is also carried by shape, motion, or text. */
export const COLOR = {
  node: 0x9fb3c8,
  module: 0x7d9bbd,
  cluster: 0x56708f,
  route: 0xb7a6ff,
  dim: 0x2f3946,
  path: 0xf2c14e, // gold = focused path
  action: 0x3ccfcf, // teal = user action / confirmation
  fault: 0xff6b5b, // coral = disconnected / stopped
  edge: 0x7a8ea6,
  selected: 0xffffff,
} as const;

export const CSS = {
  panelBg: 'rgba(12,18,30,0.92)',
  panelBorder: 'rgba(255,255,255,0.14)',
  text: '#f4f7fb',
  muted: '#a9b6c6',
  path: '#f2c14e',
  action: '#3ccfcf',
  fault: '#ff6b5b',
  buttonBg: 'rgba(40,56,80,0.95)',
  buttonPrimary: 'rgba(28,110,112,0.97)',
  buttonDisabled: 'rgba(40,46,56,0.7)',
} as const;

/** Glyph + short label per truth status, so status never depends on color alone. */
export const TRUTH_BADGE: Record<TruthStatus, { glyph: string; label: string; color: string }> = {
  observed: { glyph: '●', label: 'OBSERVED · recorded test run', color: '#7ee081' },
  static_verified: { glyph: '◆', label: 'IN SOURCE · static analysis', color: '#8fc7ff' },
  authored_model: { glyph: '▲', label: 'TEACHING MODEL · not a measurement', color: '#f2c14e' },
  inferred: { glyph: '◌', label: 'HYPOTHESIS · not verified', color: '#c9a0ff' },
  unknown: { glyph: '?', label: 'UNKNOWN', color: '#a9b6c6' },
};
