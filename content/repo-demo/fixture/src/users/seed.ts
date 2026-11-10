import { hashPassword } from '../auth/password.ts';
import type { UserRepository } from './repository.ts';

export const DEMO_PASSWORD = 'correct horse battery staple';

/** Add the demo user used by the tests and the EXPLODE lesson. */
export async function seedDemoUsers(users: UserRepository): Promise<void> {
  users.add({
    id: 'user-1',
    email: 'ada@example.com',
    displayName: 'Ada',
    passwordHash: await hashPassword(DEMO_PASSWORD),
  });
}
