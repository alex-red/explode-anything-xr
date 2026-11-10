import type { TruthStatus } from '@explode/contracts';

/** Color semantics (INTERACTION_SPEC): every state is also carried by shape, motion, or text. */
export const COLOR = {
  // Neutral states are the hologram's own light: cool blues, with violet for entry points.
  node: 0x58c8ff,
  module: 0x3d9bff,
  cluster: 0x2f6fe0,
  route: 0xb98cff,
  dim: 0x1b2a3c,
  path: 0xffc23d, // gold = focused path
  action: 0x2fe6d6, // teal = user action / confirmation
  fault: 0xff5a5f, // coral = disconnected / stopped
  edge: 0x3f9fe0,
  selected: 0xffffff,
  stage: 0x35c8ff, // the projector stage under the model
} as const;

export const CSS = {
  // Dark glass with a neon edge: readable over a bright room, and still a hologram.
  panelBg: 'rgba(4,13,26,0.88)',
  panelBorder: 'rgba(70,214,255,0.8)',
  panelGlow: 'rgba(70,214,255,0.55)',
  text: '#eef8ff',
  muted: '#8fb6cf',
  path: '#ffc23d',
  action: '#2fe6d6',
  fault: '#ff5a5f',
  buttonBg: 'rgba(7,28,50,0.93)',
  buttonHover: 'rgba(14,66,104,0.97)',
  buttonPrimary: 'rgba(0,112,128,0.96)',
  buttonDisabled: 'rgba(12,20,32,0.62)',
} as const;

/** Glyph + short label per truth status, so status never depends on color alone. */
export const TRUTH_BADGE: Record<TruthStatus, { glyph: string; label: string; color: string }> = {
  observed: { glyph: '●', label: 'OBSERVED · recorded test run', color: '#7ee081' },
  static_verified: { glyph: '◆', label: 'IN SOURCE · static analysis', color: '#8fc7ff' },
  authored_model: { glyph: '▲', label: 'TEACHING MODEL · not a measurement', color: '#f2c14e' },
  inferred: { glyph: '◌', label: 'HYPOTHESIS · not verified', color: '#c9a0ff' },
  unknown: { glyph: '?', label: 'UNKNOWN', color: '#a9b6c6' },
};
