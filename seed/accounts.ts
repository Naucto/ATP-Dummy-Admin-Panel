import type { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { config, SEED_DOMAIN } from './config';
import { daysAgo } from './random';

interface SeedAccount {
  username: string;
  role?: 'Admin' | 'Moderator' | 'Viewer';
  nickname?: string;
  description?: string;
  joinedDaysAgo: number;
}

/**
 * `admin` comes first: it is the marker `databaseState` looks for, so a seed that stops halfway
 * still leaves a database the next run may wipe.
 */
const ACCOUNTS: SeedAccount[] = [
  { username: 'admin', role: 'Admin', nickname: 'Dummy admin', joinedDaysAgo: 140 },
  { username: 'moderator', role: 'Moderator', nickname: 'Dummy moderator', joinedDaysAgo: 120 },
  { username: 'viewer', role: 'Viewer', nickname: 'Dummy viewer', joinedDaysAgo: 100 },
  {
    username: 'camille',
    role: 'Moderator',
    description: 'Weekend moderator, weekday platformer addict.',
    joinedDaysAgo: 110,
  },
  {
    username: 'alexis',
    description: 'Building the console the console deserves.',
    joinedDaysAgo: 130,
  },
  { username: 'louis', description: 'I love making games', joinedDaysAgo: 128 },
  { username: 'edgar', description: 'Ferries, mostly.', joinedDaysAgo: 121 },
  {
    username: 'thea',
    nickname: 'théodore',
    description: 'Moon lander enthusiast.',
    joinedDaysAgo: 117,
  },
  { username: 'ulysse', description: 'Snake, but eight-bit.', joinedDaysAgo: 109 },
  { username: 'vincent', joinedDaysAgo: 96 },
  { username: 'marie', joinedDaysAgo: 88 },
  { username: 'julien', description: 'New here.', joinedDaysAgo: 61 },
  { username: 'kenza', joinedDaysAgo: 54 },
  { username: 'sacha', joinedDaysAgo: 47 },
  {
    username: 'freecoins4u',
    nickname: 'FREE COINS',
    description: 'Free coins for every game, link in my games.',
    joinedDaysAgo: 34,
  },
  { username: 'grumpy_gus', description: 'Telling it like it is.', joinedDaysAgo: 52 },
  {
    username: 'copycat',
    nickname: 'Totally Original',
    description: 'All games made by me and only me.',
    joinedDaysAgo: 29,
  },
  { username: 'loud_larry', description: 'CAPS LOCK IS CRUISE CONTROL', joinedDaysAgo: 66 },
  { username: 'gone_gary', description: 'Selling accounts, ask me.', joinedDaysAgo: 44 },
];

export class Accounts {
  constructor(private readonly ids: Map<string, number>) {}

  id(username: string): number {
    const id = this.ids.get(username);
    if (id === undefined) {
      throw new Error(`no seeded account named ${username}`);
    }
    return id;
  }
}

export function emailOf(username: string): string {
  return `${username}@${SEED_DOMAIN}`;
}

export async function seedAccounts(prisma: PrismaClient): Promise<Accounts> {
  const password = await bcrypt.hash(config.password, 10);
  const ids = new Map<string, number>();
  for (const account of ACCOUNTS) {
    const row = await prisma.user.create({
      data: {
        email: emailOf(account.username),
        username: account.username,
        nickname: account.nickname ?? null,
        description: account.description ?? null,
        role: account.role ?? 'User',
        password,
        createdAt: daysAgo(account.joinedDaysAgo),
      },
      select: { id: true },
    });
    ids.set(account.username, row.id);
  }
  return new Accounts(ids);
}

/**
 * Gives the person running the stack an admin account of their own. USERNAME is an email address,
 * or a name that gets one on the seed's domain. Answers the address to sign in with.
 */
export async function seedOperator(prisma: PrismaClient): Promise<string | null> {
  if (!config.operator) {
    return null;
  }
  const { login } = config.operator;
  const email = (login.includes('@') ? login : emailOf(login)).toLowerCase();
  const password = await bcrypt.hash(config.operator.password, 10);
  const name = (login.split('@')[0] ?? login).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 24);
  const taken = await prisma.user.findUnique({ where: { username: name }, select: { email: true } });
  const username = taken && taken.email !== email ? `${name}_admin` : name;
  await prisma.user.upsert({
    where: { email },
    update: { password, role: 'Admin' },
    create: { email, username, password, role: 'Admin', createdAt: daysAgo(140) },
  });
  return email;
}

export const STAFF = ACCOUNTS.filter((account) => account.role !== undefined).map(
  (account) => account.username,
);

export const PLAYERS = ACCOUNTS.filter((account) => account.role === undefined).map(
  (account) => account.username,
);
