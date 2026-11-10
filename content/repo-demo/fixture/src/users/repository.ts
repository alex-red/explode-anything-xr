export interface User {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
}

/** In-memory user store keyed by normalized email. */
export class UserRepository {
  users = new Map<string, User>();

  /** Add or replace a user. */
  add(user: User): void {
    this.users.set(normalizeEmail(user.email), user);
  }

  /** Find a user by email, ignoring case and surrounding spaces. */
  findByEmail(email: string): User | null {
    return this.users.get(normalizeEmail(email)) ?? null;
  }

  /** Find a user by id. */
  findById(id: string): User | null {
    for (const user of this.users.values()) if (user.id === id) return user;
    return null;
  }
}

/** Normalize an email address for lookups. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
