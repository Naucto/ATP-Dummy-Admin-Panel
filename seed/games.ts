import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Prisma, PrismaClient } from '@prisma/client';

import { computeContentSize } from '../backend/src/routes/project/content-size';
import { projectKeys } from '../backend/src/routes/project/project-keys';
import type { Accounts } from './accounts';
import { coverPng } from './png';
import { after, between, daysAgo, HOUR_MS, hoursAgo, MINUTE_MS, sample } from './random';
import { publicUrl, put } from './storage';

const SNAKE = [
  '..1111..',
  '.111111.',
  '11.11.11',
  '11111111',
  '11111111',
  '1.1111.1',
  '11.11.11',
  '.1....1.',
];
const LANDER = [
  '...44...',
  '..4444..',
  '.444444.',
  '44444444',
  '4.4444.4',
  '..8..8..',
  '.8....8.',
  '8......8',
];
const FERRY = [
  '........',
  '..5555..',
  '.555555.',
  '55555555',
  '.111111.',
  '..1111..',
  '........',
  '........',
];
const COIN = [
  '..4444..',
  '.444444.',
  '44433444',
  '44344444',
  '44344444',
  '44433444',
  '.444444.',
  '..4444..',
];
const SKULL = [
  '.555555.',
  '55555555',
  '5.0550.5',
  '5.0550.5',
  '55555555',
  '.550055.',
  '.5.55.5.',
  '.5.55.5.',
];

export const SPRITES = [SNAKE, LANDER, FERRY, COIN, SKULL];

/** Game documents built by the Frontend's `tools/seed-content.ts --content-only`. */
const FIXTURES = [
  'your-first-game',
  'platformer-tutorial',
  'snake-8-bit',
  'moon-lander',
  'ferry-click',
  'duel',
] as const;
type Fixture = (typeof FIXTURES)[number];

interface SeedComment {
  key?: string;
  author: string;
  body: string;
  daysAgo: number;
  /** Removed by a moderator, with the text kept for a restore. */
  hiddenDaysAgo?: number;
  /** Deleted by a moderator: the text is gone for good. */
  deletedDaysAgo?: number;
  replies?: SeedComment[];
}

interface SeedGame {
  key: string;
  author: string;
  name: string;
  shortDesc: string;
  longDesc?: string;
  tags: string[];
  fixture: Fixture;
  sprite: string[];
  sky: number;
  createdDaysAgo: number;
  /** Absent for a draft that was never published. */
  publishedDaysAgo?: number;
  /** Withheld by moderation since then. */
  hiddenDaysAgo?: number;
  forkOf?: string;
  views?: number;
  comments?: SeedComment[];
}

const GAMES: SeedGame[] = [
  {
    key: 'first-game',
    author: 'alexis',
    name: 'Your First Game',
    shortDesc: 'A one-screen coin hunt, the ten-minute tutorial.',
    longDesc: 'Walls to walk into, five coins to collect, a score and a win.',
    tags: ['tutorial', 'remixable'],
    fixture: 'your-first-game',
    sprite: COIN,
    sky: 11,
    createdDaysAgo: 78,
    publishedDaysAgo: 75,
    views: 912,
  },
  {
    key: 'platformer',
    author: 'alexis',
    name: 'Platformer Tutorial',
    shortDesc: 'A tiny run-and-jump, built as a tutorial.',
    longDesc: 'Every system in one screen: sprites, a map, collision, and a jump that feels right.',
    tags: ['tutorial', 'platformer', 'remixable'],
    fixture: 'platformer-tutorial',
    sprite: LANDER,
    sky: 11,
    createdDaysAgo: 77,
    publishedDaysAgo: 74,
    views: 1480,
    comments: [
      {
        author: 'thea',
        body: 'The coyote time on the jump is what makes this feel right. Worth saying so in the code.',
        daysAgo: 70,
        replies: [
          {
            author: 'alexis',
            body: 'Four frames. Any more and it starts to feel floaty.',
            daysAgo: 69,
          },
        ],
      },
      {
        author: 'sacha',
        body: 'Followed it end to end and shipped something. Thank you.',
        daysAgo: 41,
      },
      { author: 'julien', body: 'The map section could use one more screenshot.', daysAgo: 30 },
    ],
  },
  {
    key: 'snake',
    author: 'ulysse',
    name: 'Snake 8-bit',
    shortDesc: 'The tick rate is the whole game.',
    longDesc:
      'A snake that steps every six frames and buffers one input, so a late turn still registers.\n\nArrows or WASD to steer. Z to restart.',
    tags: ['arcade', 'classic'],
    fixture: 'snake-8-bit',
    sprite: SNAKE,
    sky: 9,
    createdDaysAgo: 72,
    publishedDaysAgo: 70,
    views: 2310,
    comments: [
      {
        author: 'louis',
        body: 'Got 1240 without dying once. The tick rate feels perfect, most snake clones are twitchier than this.',
        daysAgo: 66,
        replies: [
          {
            author: 'ulysse',
            body: 'It steps every 6 frames and buffers one input, so a late turn still registers.',
            daysAgo: 66,
          },
        ],
      },
      {
        author: 'edgar',
        body: 'Remixed it into a two-player version with net.state. Took about twenty lines.',
        daysAgo: 21,
      },
      {
        author: 'marie',
        body: 'The wall collision feels one pixel generous and I am here for it.',
        daysAgo: 44,
      },
      {
        key: 'speed-setting',
        author: 'vincent',
        body: 'Would love a speed setting.',
        daysAgo: 12,
      },
      {
        key: 'spam-on-snake',
        author: 'freecoins4u',
        body: 'FREE COINS for this game!!! Go to free-coins.example and type your password to claim. Works 100%!!!',
        daysAgo: 33,
        hiddenDaysAgo: 31,
      },
    ],
  },
  {
    key: 'lander',
    author: 'thea',
    name: 'Moon Lander',
    shortDesc: 'Thrust, drift, regret.',
    longDesc: 'Land under 2 m/s. Fuel is finite and gravity is not.',
    tags: ['arcade', 'physics'],
    fixture: 'moon-lander',
    sprite: LANDER,
    sky: 9,
    createdDaysAgo: 64,
    publishedDaysAgo: 61,
    views: 1175,
    comments: [
      {
        author: 'thea',
        body: 'Fuel burn is per-frame while held, so tapping is cheaper than holding.',
        daysAgo: 60,
      },
      {
        author: 'kenza',
        body: 'Landed on the third try. The shadow under the lander helps a lot.',
        daysAgo: 38,
      },
      {
        key: 'gus-on-lander',
        author: 'grumpy_gus',
        body: '',
        daysAgo: 25,
        deletedDaysAgo: 23,
      },
      {
        key: 'copycat-plug',
        author: 'copycat',
        body: 'Mine is better. Play Moon Lander HD instead, link on my profile.',
        daysAgo: 8,
      },
    ],
  },
  {
    key: 'ferry',
    author: 'edgar',
    name: 'Ferry Click',
    shortDesc: 'Ferries, mostly.',
    longDesc: 'Click a ferry, it goes. That is the entire design document.',
    tags: ['puzzle', 'relaxing'],
    fixture: 'ferry-click',
    sprite: FERRY,
    sky: 11,
    createdDaysAgo: 50,
    publishedDaysAgo: 48,
    views: 640,
    comments: [{ author: 'louis', body: 'Unreasonably calming.', daysAgo: 40 }],
  },
  {
    key: 'duel',
    author: 'louis',
    name: 'Duel',
    shortDesc: 'Two players, one screen, shared state.',
    longDesc: 'Everything both players can see lives in net.state. The panel just shows it.',
    tags: ['multiplayer', 'arcade'],
    fixture: 'duel',
    sprite: SNAKE,
    sky: 14,
    createdDaysAgo: 36,
    publishedDaysAgo: 33,
    views: 505,
    comments: [
      {
        author: 'edgar',
        body: 'Twenty lines of net.state and it just works. Rude.',
        daysAgo: 30,
      },
      {
        key: 'larry-on-duel',
        author: 'loud_larry',
        body: 'THIS GAME IS FINE I GUESS',
        daysAgo: 4,
      },
    ],
  },
  {
    key: 'snake-duo',
    author: 'edgar',
    name: 'Snake Duo',
    shortDesc: 'The same snake, for two on one keyboard.',
    tags: ['arcade', 'multiplayer'],
    fixture: 'snake-8-bit',
    sprite: SNAKE,
    sky: 13,
    createdDaysAgo: 22,
    publishedDaysAgo: 20,
    forkOf: 'snake',
    views: 188,
    comments: [{ author: 'ulysse', body: 'Nice fork. Player two is very green.', daysAgo: 19 }],
  },
  {
    key: 'pixel-brawl',
    author: 'grumpy_gus',
    name: 'Pixel Brawl',
    shortDesc: 'Two skulls enter, one skull leaves.',
    longDesc: 'A one-button brawler. Cartoon skulls, cartoon bonks.',
    tags: ['arcade', 'fighting'],
    fixture: 'duel',
    sprite: SKULL,
    sky: 8,
    createdDaysAgo: 16,
    publishedDaysAgo: 14,
    views: 231,
    comments: [
      {
        author: 'marie',
        body: 'A bit much for me, but the hit pause is great.',
        daysAgo: 13,
      },
    ],
  },
  {
    key: 'tiny-golf',
    author: 'marie',
    name: 'Tiny Golf',
    shortDesc: 'Nine holes on one screen.',
    tags: ['sports'],
    fixture: 'your-first-game',
    sprite: COIN,
    sky: 13,
    createdDaysAgo: 30,
  },
  {
    key: 'roguelike',
    author: 'kenza',
    name: 'Untitled Roguelike',
    shortDesc: 'Work in progress.',
    tags: [],
    fixture: 'platformer-tutorial',
    sprite: SKULL,
    sky: 15,
    createdDaysAgo: 12,
  },
  {
    key: 'lander-hd',
    author: 'copycat',
    name: 'Moon Lander HD',
    shortDesc: 'The best lander game, 100% original.',
    longDesc: 'Land on the moon. Made entirely by me.',
    tags: ['arcade', 'physics'],
    fixture: 'moon-lander',
    sprite: LANDER,
    sky: 10,
    createdDaysAgo: 10,
    publishedDaysAgo: 9,
    views: 96,
    comments: [
      {
        author: 'thea',
        body: 'This is my game with a different title screen.',
        daysAgo: 8,
      },
    ],
  },
  {
    key: 'free-coins',
    author: 'freecoins4u',
    name: 'FREE COINS CLICK HERE',
    shortDesc: 'Free coins for every game!!! free-coins.example',
    longDesc: 'Type your Naucto password at free-coins.example to get 9999 coins instantly.',
    tags: ['free', 'coins'],
    fixture: 'ferry-click',
    sprite: COIN,
    sky: 7,
    createdDaysAgo: 7,
    publishedDaysAgo: 6,
    hiddenDaysAgo: 5,
    views: 41,
  },
];

const FEATURED = [
  { game: 'snake', startsDaysAgo: 28, endsDaysAgo: 14, note: 'A classic done right.' },
  { game: 'platformer', startsDaysAgo: 14, note: 'Start here if you want to make your own.' },
];

const PLAYED_TOGETHER = [
  { game: 'snake-duo', host: 'edgar', guests: ['ulysse'], hoursAgo: 5, players: 2 },
  { game: 'duel', host: 'louis', guests: ['sacha'], hoursAgo: 27, players: 2 },
  { game: 'duel', host: 'alexis', guests: ['louis', 'thea'], hoursAgo: 76, players: 4 },
  { game: 'ferry', host: 'thea', guests: ['alexis', 'marie'], hoursAgo: 199, players: 3 },
];

export class Games {
  constructor(
    private readonly games: Map<string, number>,
    private readonly comments: Map<string, number>,
  ) {}

  id(key: string): number {
    const id = this.games.get(key);
    if (id === undefined) {
      throw new Error(`no seeded game under ${key}`);
    }
    return id;
  }

  comment(key: string): number {
    const id = this.comments.get(key);
    if (id === undefined) {
      throw new Error(`no seeded comment under ${key}`);
    }
    return id;
  }
}

const fixtureCache = new Map<Fixture, Buffer>();

function fixture(name: Fixture): Buffer {
  let bytes = fixtureCache.get(name);
  if (!bytes) {
    bytes = readFileSync(join(__dirname, 'fixtures', 'games', `${name}.bin`));
    fixtureCache.set(name, bytes);
  }
  return bytes;
}

interface ReleaseText {
  name: string;
  shortDesc: string;
  longDesc: string | null;
  tags: string[];
}

/** The hash `ProjectContentService` keeps of a release, so republishing it unchanged is a no-op. */
function releaseContentHash(bytes: Buffer, text: ReleaseText): string {
  return createHash('sha256')
    .update(bytes)
    .update(JSON.stringify([text.name, text.shortDesc, text.longDesc, text.tags]))
    .digest('hex');
}

interface StoredGame {
  id: number;
  savedAt: Date;
  state: 'draft' | 'published' | 'withheld';
  content: Buffer;
  cover: Buffer;
}

/** Puts a game's objects where the backend looks for them, and answers what its row says of them. */
async function storeObjects(game: StoredGame): Promise<Prisma.ProjectUncheckedUpdateInput> {
  const contentSize = computeContentSize(game.content);
  await put(
    projectKeys.save(game.id, String(game.savedAt.getTime())),
    game.content,
    'application/octet-stream',
  );
  if (game.state === 'published') {
    await put(projectKeys.release(game.id), game.content, 'application/octet-stream', 'no-cache');
  }
  if (game.state === 'withheld') {
    await put(projectKeys.withheldRelease(game.id), game.content, 'application/octet-stream');
    await put(projectKeys.withheldCover(game.id), game.cover, 'image/png');
  } else {
    await put(projectKeys.cover(game.id), game.cover, 'image/png', 'no-cache');
  }
  return {
    contentSize: contentSize as unknown as Prisma.InputJsonObject,
    contentSizeTotal: contentSize.total,
    iconUrl: game.state === 'withheld' ? null : publicUrl(projectKeys.cover(game.id)),
  };
}

async function seedComments(
  prisma: PrismaClient,
  accounts: Accounts,
  projectId: number,
  comments: SeedComment[],
  keys: Map<string, number>,
  parentId: number | null = null,
): Promise<void> {
  for (const comment of comments) {
    const removedDaysAgo = comment.deletedDaysAgo ?? comment.hiddenDaysAgo;
    const row = await prisma.comment.create({
      data: {
        authorId: accounts.id(comment.author),
        projectId,
        parentId,
        content: comment.body,
        deleted: comment.deletedDaysAgo !== undefined,
        hiddenAt: removedDaysAgo === undefined ? null : daysAgo(removedDaysAgo),
        createdAt: daysAgo(comment.daysAgo),
      },
      select: { id: true },
    });
    if (comment.key) {
      keys.set(comment.key, row.id);
    }
    await seedComments(prisma, accounts, projectId, comment.replies ?? [], keys, row.id);
  }
}

export async function seedGames(
  prisma: PrismaClient,
  accounts: Accounts,
  players: readonly number[],
): Promise<Games> {
  const ids = new Map<string, number>();
  const comments = new Map<string, number>();

  for (const game of GAMES) {
    const createdAt = daysAgo(game.createdDaysAgo);
    const publishedAt =
      game.publishedDaysAgo === undefined ? null : daysAgo(game.publishedDaysAgo, 5);
    const hiddenAt = game.hiddenDaysAgo === undefined ? null : daysAgo(game.hiddenDaysAgo);
    const savedAt = publishedAt
      ? after(publishedAt, -20 * MINUTE_MS)
      : after(createdAt, 3 * HOUR_MS);
    const text: ReleaseText = {
      name: game.name,
      shortDesc: game.shortDesc,
      longDesc: game.longDesc ?? null,
      tags: game.tags,
    };
    const content = fixture(game.fixture);
    const authorId = accounts.id(game.author);
    const fans = publishedAt
      ? sample(
          players.filter((player) => player !== authorId),
          between(2, 9),
        )
      : [];
    const views = game.views ?? 0;

    const project = await prisma.project.create({
      data: {
        ...text,
        userId: authorId,
        status: publishedAt ? 'COMPLETED' : 'IN_PROGRESS',
        createdAt,
        updatedAt: savedAt,
        forkedFromId: game.forkOf ? (ids.get(game.forkOf) ?? null) : null,
        ...(publishedAt
          ? {
              publishedAt,
              publishedName: text.name,
              publishedShortDesc: text.shortDesc,
              publishedLongDesc: text.longDesc,
              publishedTags: text.tags,
              releaseRevision: 1,
              releaseContentHash: releaseContentHash(content, text),
            }
          : {}),
        hiddenAt,
        viewCount: views,
        uniquePlayers: Math.round(views * 0.62),
        likes: fans.length,
      },
      select: { id: true },
    });
    ids.set(game.key, project.id);

    const stored = await storeObjects({
      id: project.id,
      savedAt,
      state: hiddenAt ? 'withheld' : publishedAt ? 'published' : 'draft',
      content,
      cover: coverPng(game.sprite, game.sky),
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { ...stored, updatedAt: savedAt },
    });

    await prisma.analyticsFact.create({
      data: {
        dedupeKey: `project:${String(project.id)}`,
        type: 'PROJECT_CREATED',
        at: createdAt,
        actorUserId: authorId,
        projectId: project.id,
      },
    });
    if (publishedAt) {
      await prisma.analyticsFact.create({
        data: {
          dedupeKey: `release:${String(project.id)}:1`,
          type: 'RELEASE_PUBLISHED',
          at: publishedAt,
          actorUserId: authorId,
          projectId: project.id,
        },
      });
      await prisma.like.createMany({
        data: fans.map((userId) => ({
          userId,
          projectId: project.id,
          createdAt: after(publishedAt, between(1, 200) * HOUR_MS),
        })),
      });
    }

    await seedComments(prisma, accounts, project.id, game.comments ?? [], comments);
  }

  const games = new Games(ids, comments);
  for (const pick of FEATURED) {
    await prisma.featuredRelease.create({
      data: {
        projectId: games.id(pick.game),
        featuredById: accounts.id('admin'),
        note: pick.note,
        startsAt: daysAgo(pick.startsDaysAgo),
        endsAt: pick.endsDaysAgo === undefined ? null : daysAgo(pick.endsDaysAgo),
        createdAt: daysAgo(pick.startsDaysAgo),
      },
    });
  }
  for (const session of PLAYED_TOGETHER) {
    const startedAt = hoursAgo(session.hoursAgo);
    await prisma.gameSession.create({
      data: {
        hostId: accounts.id(session.host),
        projectId: games.id(session.game),
        title: GAMES.find((game) => game.key === session.game)?.name ?? session.game,
        maxPlayers: session.players,
        startedAt,
        endedAt: after(startedAt, 45 * MINUTE_MS),
        otherUsers: { connect: session.guests.map((guest) => ({ id: accounts.id(guest) })) },
      },
    });
  }
  return games;
}

/**
 * Gives a document and a cover to every game that has none: the sample games and the forks the
 * analytics seed writes as rows only. Each then opens and plays like any other.
 */
export async function fillMissingContent(prisma: PrismaClient): Promise<number> {
  const bare = await prisma.project.findMany({
    where: { contentSizeTotal: null },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      name: true,
      shortDesc: true,
      longDesc: true,
      tags: true,
      createdAt: true,
      publishedAt: true,
      hiddenAt: true,
    },
  });
  for (const project of bare) {
    const content = fixture(FIXTURES[project.id % FIXTURES.length] ?? 'your-first-game');
    const sprite = SPRITES[project.id % SPRITES.length] ?? COIN;
    const savedAt = project.publishedAt
      ? after(project.publishedAt, -20 * MINUTE_MS)
      : after(project.createdAt, 3 * HOUR_MS);
    const stored = await storeObjects({
      id: project.id,
      savedAt,
      state: project.hiddenAt ? 'withheld' : project.publishedAt ? 'published' : 'draft',
      content,
      cover: coverPng(sprite, 9 + (project.id % 6)),
    });
    await prisma.project.update({
      where: { id: project.id },
      data: {
        ...stored,
        updatedAt: savedAt,
        ...(project.publishedAt ? { releaseContentHash: releaseContentHash(content, project) } : {}),
      },
    });
  }
  return bare.length;
}
