/** Runtime settings for auth-service. */
export interface Settings {
  sessionSecret: string;
  sessionTtlMs: number;
  loginAttemptsPerMinute: number;
}

/** Load settings with demo defaults. A real service would read these from the environment. */
export function loadSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    sessionSecret: 'demo-secret-change-me',
    sessionTtlMs: 30 * 60 * 1000,
    loginAttemptsPerMinute: 5,
    ...overrides,
  };
}
