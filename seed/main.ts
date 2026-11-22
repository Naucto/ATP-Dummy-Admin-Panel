import { seedAnalytics } from '../backend/prisma/seed-dev-analytics';
import { emailOf, PLAYERS, seedAccounts, seedOperator, STAFF } from './accounts';
import { config } from './config';
import { connect, databaseState, migrate, waitForDatabase, wipe } from './database';
import { fillMissingContent, seedGames } from './games';
import { seedModeration } from './moderation';
import { bucketState, resetBucket } from './storage';
import { seedSupport } from './support';

async function main(): Promise<void> {
  const prisma = connect();
  try {
    await waitForDatabase(prisma);
    migrate();

    const database = await databaseState(prisma);
    const bucket = await bucketState();
    if (database === 'foreign' || bucket === 'foreign') {
      throw new Error(
        `The ${database === 'foreign' ? 'database' : 'bucket'} holds data this seed did not write. ` +
          'It wipes what it fills, so it only ever runs against a database and a bucket of its own.',
      );
    }
    if (config.mode === 'once' && database === 'seeded') {
      console.log('seed: already seeded and SEED_MODE=once, nothing to do');
      return;
    }

    await wipe(prisma);
    await resetBucket();

    const accounts = await seedAccounts(prisma);
    const operator = await seedOperator(prisma);
    const games = await seedGames(
      prisma,
      accounts,
      PLAYERS.map((username) => accounts.id(username)),
    );
    console.log(`seed: analytics, ${await seedAnalytics(prisma)}`);
    console.log(`seed: ${String(await fillMissingContent(prisma))} more games given content`);
    console.log(`seed: moderation, ${await seedModeration(prisma, accounts, games)}`);
    console.log(`seed: support, ${await seedSupport(prisma, accounts, games)}`);

    console.log(`seed: done. Staff sign in with the password in SEED_PASSWORD:`);
    for (const username of STAFF) {
      console.log(`  ${emailOf(username)}`);
    }
    if (operator) {
      console.log(`seed: ${operator} signs in as an admin with the password in PASSWORD`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
