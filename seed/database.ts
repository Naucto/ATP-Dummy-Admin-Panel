import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { emailOf } from './accounts';
import { config } from './config';

/** The account whose presence says this seed filled the database. It is written first. */
const MARKER_EMAIL = emailOf('admin');

const ATTEMPTS = 60;
const ATTEMPT_DELAY_MS = 2_000;

export function connect(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) });
}

export async function waitForDatabase(prisma: PrismaClient): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (error) {
      if (attempt === ATTEMPTS) {
        throw error;
      }
      await sleep(ATTEMPT_DELAY_MS);
    }
  }
}

export function migrate(): void {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
}

export type DatabaseState = 'empty' | 'seeded' | 'foreign';

/**
 * Whose data the database holds. A database with accounts and without the marker was filled by
 * something else, and the seed never wipes it.
 */
export async function databaseState(prisma: PrismaClient): Promise<DatabaseState> {
  if ((await prisma.user.count()) === 0) {
    return 'empty';
  }
  const marker = await prisma.user.findUnique({
    where: { email: MARKER_EMAIL },
    select: { id: true },
  });
  return marker ? 'seeded' : 'foreign';
}

export async function wipe(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  const names = tables.map((table) => `"${table.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}
