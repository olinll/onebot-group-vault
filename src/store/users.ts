import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { User } from '../core/types.js';

const USERS_FILE = join(__dirname, '..', '..', 'storage', 'data', 'users.json');

function ensureDir() {
  mkdirSync(dirname(USERS_FILE), { recursive: true });
}

export function loadUsers(): User[] {
  try {
    if (!existsSync(USERS_FILE)) return [];
    return JSON.parse(readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

export function saveUsers(users: User[]): void {
  ensureDir();
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

export function findUser(username: string): User | undefined {
  return loadUsers().find((u) => u.username === username);
}

export function ensureDefaultAdmin(): void {
  const users = loadUsers();
  if (users.length > 0) return;
  users.push({
    username: 'admin',
    password: 'admin123',
    role: 'admin',
    createdAt: Date.now(),
  });
  saveUsers(users);
  console.log('[auth] Created default admin account (admin/admin123)');
}
