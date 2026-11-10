export interface AuditEntry {
  event: string;
  detail: Record<string, string>;
  at: number;
}

/** Append-only in-memory audit trail of security events. */
export class AuditLog {
  entries: AuditEntry[] = [];

  /** Record a security event. */
  record(event: string, detail: Record<string, string> = {}): void {
    this.entries.push({ event, detail, at: Date.now() });
  }

  /** The most recent events, newest last. */
  recent(count: number): AuditEntry[] {
    return this.entries.slice(-count);
  }
}
