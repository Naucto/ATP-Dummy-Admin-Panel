import type {
  BugCategory,
  CrashSource,
  Prisma,
  PrismaClient,
  RatingReason,
  ReportStatus,
} from '@prisma/client';

import { crashGroupKey } from '../backend/src/routes/reports/crash-group';
import type { Accounts } from './accounts';
import { SPRITES } from './games';
import type { Games } from './games';
import { screenshotPng } from './png';
import {
  after,
  between,
  chance,
  DAY_MS,
  daysAgo,
  HOUR_MS,
  hoursAgo,
  MINUTE_MS,
  pick,
  sample,
  weighted,
} from './random';
import { put } from './storage';

const APP_RELEASES = ['1.3.0+9c41e7a', '1.3.1+2be0f15', '1.4.0+71ad3c9', '1.4.1+fb3e183'];
const LATEST_RELEASE = '1.4.1+fb3e183';

const DEVICES = [
  { device: 'desktop', browser: 'Chrome', os: 'Windows' },
  { device: 'desktop', browser: 'Firefox', os: 'Linux' },
  { device: 'desktop', browser: 'Safari', os: 'Mac OS' },
  { device: 'desktop', browser: 'Edge', os: 'Windows' },
  { device: 'mobile', browser: 'Mobile Safari', os: 'iOS' },
  { device: 'mobile', browser: 'Chrome', os: 'Android' },
  { device: 'tablet', browser: 'Mobile Safari', os: 'iOS' },
];

function releaseAt(date: Date): string {
  const age = (Date.now() - date.getTime()) / DAY_MS;
  const index = age > 55 ? 0 : age > 35 ? 1 : age > 12 ? 2 : 3;
  return APP_RELEASES[index] ?? LATEST_RELEASE;
}

const RATING_DAYS = 80;
const RATINGS = 150;

const SCORES = [
  [1, 2],
  [2, 2],
  [3, 4],
  [4, 5],
  [5, 6],
  [6, 9],
  [7, 18],
  [8, 26],
  [9, 18],
  [10, 10],
] as const;

const REASONS: RatingReason[] = [
  'BUGS',
  'PERFORMANCE',
  'HARD_TO_USE',
  'MISSING_FEATURE',
  'CONTENT',
  'OTHER',
];

const LIKED = {
  PLAYER: [
    'Games start instantly, no install and no account wall.',
    'The pixel look is lovely and every game feels like it belongs.',
    'Playing with a friend took one link.',
    'I found three games I keep coming back to.',
    'It runs fine on my old laptop.',
    'The touch pad on my phone actually works.',
  ],
  CREATOR: [
    'Editing with a friend in real time is the reason I stayed.',
    'The sprite editor and the code tab in one window.',
    'The docs open right next to the code.',
    'I published my first game in an evening.',
    'Lua and a small API. I never felt lost.',
    'net.state made multiplayer almost too easy.',
  ],
};

const IMPROVE = {
  PLAYER: [
    'More games, and a way to sort them by length.',
    'Let me remap the keys.',
    'Sound was choppy for a few seconds on Firefox.',
    'A fullscreen button that stays put on mobile.',
    'I would like to follow creators.',
    'Search could be smarter about typos.',
  ],
  CREATOR: [
    'A code formatter would save me a lot of fiddling.',
    'The map editor needs a fill tool.',
    'Undo sometimes jumps further back than I expect.',
    'More sound presets, and a way to share instruments.',
    'I lost my place in the sheet when zooming.',
    'Autotile, please.',
  ],
};

const LOW_SCORE_NOTES = [
  'The game froze twice and I gave up.',
  'I could not work out how to start a new project.',
  'It was slow on my phone to the point of being unplayable.',
  'Half the games I opened were unfinished.',
  'My changes were gone after a reload.',
];

interface RatingRow {
  id: number;
  userId: number;
  score: number;
  createdAt: Date;
}

async function seedRatings(
  prisma: PrismaClient,
  raters: readonly number[],
  published: readonly number[],
): Promise<RatingRow[]> {
  const rows: RatingRow[] = [];
  for (let index = 0; index < RATINGS; index++) {
    const userId = raters[index % raters.length];
    if (userId === undefined) {
      break;
    }
    const role = chance(0.62) ? 'PLAYER' : 'CREATOR';
    const score = weighted(SCORES);
    const low = score <= 4;
    const createdAt = after(daysAgo(between(0, RATING_DAYS - 1)), -between(0, 23) * HOUR_MS);
    const row = await prisma.report.create({
      data: {
        kind: 'RATING',
        userId,
        role,
        score,
        reasons: low ? sample(REASONS, between(1, 3)) : [],
        liked: chance(low ? 0.2 : 0.55) ? pick(LIKED[role]) : null,
        improve: low ? pick(LOW_SCORE_NOTES) : chance(0.4) ? pick(IMPROVE[role]) : null,
        origin: chance(0.7) ? 'PROMPT' : 'MANUAL',
        route: role === 'PLAYER' ? '/hub' : '/projects',
        releaseId: role === 'PLAYER' && chance(0.8) ? pick(published) : null,
        appRelease: releaseAt(createdAt),
        createdAt,
        updatedAt: createdAt,
      },
      select: { id: true },
    });
    rows.push({ id: row.id, userId, score, createdAt });
  }
  await prisma.feedbackPrompt.createMany({
    data: [...new Set(rows.map((row) => row.userId))].map((userId) => ({
      userId,
      status: 'ANSWERED' as const,
    })),
  });
  return rows;
}

interface SeedBug {
  reporter: string;
  category: BugCategory;
  title: string;
  description: string;
  route: string;
  status: ReportStatus;
  daysAgo: number;
  game?: string;
  adminNote?: string;
  engineError?: string;
  console?: string[];
  screenshot?: boolean;
  followsLowRating?: boolean;
}

const BUGS: SeedBug[] = [
  {
    reporter: 'louis',
    category: 'EDITOR',
    title: 'Undo skips back two strokes in the sprite editor',
    description:
      'Draw three strokes, press Ctrl+Z once. The last two strokes disappear instead of one. It only happens when the strokes were drawn quickly.',
    route: '/edit/:id/art',
    status: 'IN_PROGRESS',
    daysAgo: 9,
    game: 'duel',
    adminNote: 'Reproduced. Strokes under 150 ms apart share one undo step. Fix in review.',
    screenshot: true,
  },
  {
    reporter: 'thea',
    category: 'SOUND',
    title: 'Audio crackles after switching tabs on Firefox',
    description:
      'Start a game with music, switch to another tab for a minute, come back. The sound crackles until the page is reloaded.',
    route: '/play/:id',
    status: 'TRIAGED',
    daysAgo: 6,
    game: 'lander',
    adminNote: 'Likely the worklet resuming with a stale clock. Same as the engine audio crash.',
    console: [
      '[warn] AudioContext was suspended for 61.2 s',
      '[warn] synth worklet: 4096 frames dropped',
    ],
  },
  {
    reporter: 'kenza',
    category: 'GAMEPLAY',
    title: 'Game restarts when the virtual pad is resized',
    description:
      'On my phone, changing the pad size in the menu restarts the game from the title screen. I lost a long run.',
    route: '/play/:id',
    status: 'NEW',
    daysAgo: 1,
    game: 'platformer',
    screenshot: true,
    followsLowRating: true,
  },
  {
    reporter: 'edgar',
    category: 'NETPLAY',
    title: 'Second player never leaves "connecting" behind a school network',
    description:
      'Hosting works, my friend opens the link and stays on "connecting" forever. Works fine from home. The school blocks most ports.',
    route: '/play/:id',
    status: 'TRIAGED',
    daysAgo: 12,
    game: 'duel',
    adminNote: 'TURN over 443 should cover this. Ask for the browser console next time.',
    console: [
      '[info] net: joining room as guest',
      '[warn] ice: no relay candidate gathered after 10000 ms',
      '[error] net: peer connection failed (iceConnectionState=failed)',
    ],
  },
  {
    reporter: 'marie',
    category: 'GRAPHICS',
    title: 'Sprites flicker at the screen edge on a 4K display',
    description:
      'Sprites that touch the right edge of the screen flicker by one pixel column when the window is very large.',
    route: '/play/:id',
    status: 'NEW',
    daysAgo: 2,
    game: 'ferry',
    screenshot: true,
  },
  {
    reporter: 'julien',
    category: 'ACCOUNT',
    title: 'Password reset email never arrives',
    description: 'I asked for a reset twice yesterday and once today. Nothing in spam either.',
    route: '/login',
    status: 'RESOLVED',
    daysAgo: 20,
    adminNote: 'Mail provider was rate limiting us for two days. Fixed on their side.',
  },
  {
    reporter: 'ulysse',
    category: 'PERFORMANCE',
    title: 'Editor slows down with more than 40 code tabs',
    description:
      'With 40 or so files open the CODE tab takes a second to switch between them. Typing stays fast.',
    route: '/edit/:id/code',
    status: 'NEW',
    daysAgo: 3,
    game: 'snake',
  },
  {
    reporter: 'alexis',
    category: 'EDITOR',
    title: 'Map minimap is blank after resizing the map',
    description:
      'Resize a map from 64 to 128 wide. The minimap stays empty until the tab is reopened.',
    route: '/edit/:id/map',
    status: 'RESOLVED',
    daysAgo: 31,
    game: 'platformer',
    adminNote: 'Shipped in 1.4.0.',
    screenshot: true,
  },
  {
    reporter: 'sacha',
    category: 'GAMEPLAY',
    title: 'Lua error shown on the first frame of some games',
    description:
      'A red error flashes for a moment when the game starts, then everything works. Seen on two different games.',
    route: '/play/:id',
    status: 'NEW',
    daysAgo: 0,
    game: 'snake-duo',
    engineError: 'main:14: attempt to index a nil value (field "players")',
    console: ['[error] lua: main:14: attempt to index a nil value (field "players")'],
    screenshot: true,
  },
  {
    reporter: 'vincent',
    category: 'OTHER',
    title: 'Typo on the learn page',
    description: 'The sound tutorial says "ocsillator" in the second paragraph.',
    route: '/learn/tutorials/sound',
    status: 'RESOLVED',
    daysAgo: 44,
    adminNote: 'Fixed in the docs repo.',
  },
  {
    reporter: 'thea',
    category: 'EDITOR',
    title: 'Collaborator cursor stays after they leave',
    description:
      'When my collaborator closes the tab, their cursor flag stays in my code editor until I reload.',
    route: '/edit/:id/code',
    status: 'IN_PROGRESS',
    daysAgo: 15,
    game: 'lander',
    adminNote: 'Awareness state is not cleared on an unclean close. Timeout being added.',
    screenshot: true,
  },
  {
    reporter: 'grumpy_gus',
    category: 'OTHER',
    title: 'This site is bad',
    description: 'Everything is bad. Fix it.',
    route: '/hub',
    status: 'IGNORED',
    daysAgo: 26,
    adminNote: 'Nothing to act on.',
  },
  {
    reporter: 'louis',
    category: 'NETPLAY',
    title: 'Host migration drops net.state',
    description:
      'When the host leaves a three-player room, the next host starts with an empty net.state table.',
    route: '/play/:id',
    status: 'NEW',
    daysAgo: 4,
    game: 'duel',
    console: ['[info] net: host left, electing', '[info] net: elected as host, state rev 0'],
  },
  {
    reporter: 'marie',
    category: 'GRAPHICS',
    title: 'Light theme: palette picker border is invisible',
    description: 'In the light theme the selected colour in the palette has no visible outline.',
    route: '/edit/:id/art',
    status: 'TRIAGED',
    daysAgo: 7,
    game: 'tiny-golf',
    adminNote: 'Token issue, the outline uses the dark ink in both themes.',
    screenshot: true,
    followsLowRating: true,
  },
];

async function seedBugs(
  prisma: PrismaClient,
  accounts: Accounts,
  games: Games,
  ratings: RatingRow[],
): Promise<number> {
  const lowRatings = ratings.filter((rating) => rating.score <= 4);
  for (const [index, bug] of BUGS.entries()) {
    const createdAt = after(daysAgo(bug.daysAgo), -between(1, 20) * HOUR_MS);
    const reporter = accounts.id(bug.reporter);
    const projectId = bug.game ? games.id(bug.game) : null;
    const rating = bug.followsLowRating ? lowRatings.pop() : undefined;
    if (rating) {
      await prisma.report.update({
        where: { id: rating.id },
        data: {
          userId: reporter,
          createdAt: after(createdAt, -5 * MINUTE_MS),
          updatedAt: after(createdAt, -5 * MINUTE_MS),
        },
      });
    }
    const context: Prisma.InputJsonObject = {
      viewport: pick(['1920x1080', '1536x864', '2560x1440', '390x844', '3840x2160']),
      language: pick(['fr-FR', 'en-US', 'en-GB', 'de-DE']),
      ...(bug.engineError ? { engineError: bug.engineError } : {}),
      ...(bug.console ? { console: bug.console } : {}),
      ...pick(DEVICES),
    };
    const route = bug.route.replace(':id', String(projectId ?? 0));
    const updatedAt =
      bug.status === 'NEW' ? createdAt : after(createdAt, between(2, 30) * HOUR_MS);
    const row = await prisma.report.create({
      data: {
        kind: 'BUG',
        status: bug.status,
        userId: reporter,
        role: bug.route.startsWith('/edit') ? 'CREATOR' : 'PLAYER',
        title: bug.title,
        message: bug.description,
        route,
        category: bug.category,
        projectId,
        releaseId: bug.route.startsWith('/play') ? projectId : null,
        ratingId: rating?.id ?? null,
        context,
        adminNote: bug.adminNote ?? null,
        appRelease: releaseAt(createdAt),
        createdAt,
        updatedAt,
      },
      select: { id: true },
    });
    if (bug.screenshot) {
      const png = screenshotPng(SPRITES[index % SPRITES.length] ?? [], index);
      const key = `reports/${String(row.id)}/screenshot.png`;
      await put(key, png, 'image/png');
      await prisma.report.update({
        where: { id: row.id },
        data: {
          screenshotKey: key,
          screenshotMime: 'image/png',
          screenshotBytes: png.length,
          updatedAt,
        },
      });
    }
  }
  return BUGS.length;
}

interface SeedCrash {
  source: CrashSource;
  name: string;
  message: string;
  stack: string[];
  routes: string[];
  count: number;
  status: ReportStatus;
  firstDaysAgo: number;
  lastHoursAgo: number;
  /** Came back after being resolved. */
  regressedHoursAgo?: number;
  adminNote?: string;
  extra?: Prisma.InputJsonObject;
}

const CRASHES: SeedCrash[] = [
  {
    source: 'WEB',
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'sheets')",
    stack: [
      'at ArtStore.activeSheet (apps/web/src/app/features/editor/art/art.store.ts:88:31)',
      'at SheetMapComponent.draw (apps/web/src/app/features/editor/art/sheet-map.component.ts:142:24)',
      'at ResizeObserver.<anonymous> (apps/web/src/app/features/editor/art/sheet-map.component.ts:61:12)',
    ],
    routes: ['/edit/:id/art'],
    count: 184,
    status: 'IN_PROGRESS',
    firstDaysAgo: 19,
    lastHoursAgo: 2,
    adminNote: 'Art tab opened before the document finished loading.',
  },
  {
    source: 'ENGINE',
    name: 'WebGLContextLost',
    message: 'WebGL context lost while presenting frame 48213',
    stack: [
      'at WebGLBackend.present (packages/engine/src/gfx/webgl/WebGLBackend.ts:214:13)',
      'at Engine.frame (packages/engine/src/Engine.ts:331:18)',
      'at Engine.loop (packages/engine/src/Engine.ts:287:10)',
    ],
    routes: ['/play/:id', '/edit/:id/code'],
    count: 67,
    status: 'TRIAGED',
    firstDaysAgo: 41,
    lastHoursAgo: 7,
    adminNote: 'Mostly mobile Safari after backgrounding. Restore path exists, verify it runs.',
    extra: { fault: 'webgl-context-lost' },
  },
  {
    source: 'ENGINE',
    name: 'AudioFault',
    message: 'AudioWorklet processor "naucto-synth" stopped answering after 2000 ms',
    stack: [
      'at AudioBackend.watchdog (packages/engine/src/sound/AudioBackend.ts:176:15)',
      'at AudioBackend.resume (packages/engine/src/sound/AudioBackend.ts:121:10)',
    ],
    routes: ['/play/:id'],
    count: 23,
    status: 'NEW',
    firstDaysAgo: 8,
    lastHoursAgo: 5,
    extra: { fault: 'audio-worklet-stalled', audioState: 'suspended' },
  },
  {
    source: 'WEB',
    name: 'ChunkLoadError',
    message: 'Loading chunk editor-shell failed after 3 retries',
    stack: [
      'at loadChunk (apps/web/src/main.ts:1:5120)',
      'at editor.routes (apps/web/src/app/app.routes.ts:44:29)',
    ],
    routes: ['/edit/:id', '/projects'],
    count: 312,
    status: 'RESOLVED',
    firstDaysAgo: 52,
    lastHoursAgo: 30,
    adminNote: 'Old tabs asking for chunks of a previous deploy. Old bundles are now kept a week.',
  },
  {
    source: 'BACKEND',
    name: 'PrismaClientKnownRequestError',
    message: 'Unique constraint failed on the fields: (`userId`,`projectId`)',
    stack: [
      'at LikeService.like (src/routes/project/like.service.ts:41:28)',
      'at ProjectController.like (src/routes/project/project.controller.ts:302:5)',
    ],
    routes: ['POST /projects/:id/like'],
    count: 41,
    status: 'NEW',
    firstDaysAgo: 6,
    lastHoursAgo: 1,
    regressedHoursAgo: 20,
    adminNote: 'Was fixed in 1.4.0 with an upsert, back since the like button was reworked.',
  },
  {
    source: 'BACKEND',
    name: 'S3UploadException',
    message: 'Upload of save/118/1766012000000 failed: socket hang up',
    stack: [
      'at S3Service.uploadFile (src/routes/s3/s3.service.ts:210:15)',
      'at ProjectContentService.save (src/routes/project/project-content.service.ts:231:5)',
    ],
    routes: ['PATCH /projects/:id/content'],
    count: 9,
    status: 'TRIAGED',
    firstDaysAgo: 14,
    lastHoursAgo: 50,
    adminNote: 'Storage provider blips. Add one retry before failing the save.',
  },
  {
    source: 'WEB',
    name: 'RangeError',
    message: 'Maximum call stack size exceeded',
    stack: [
      'at PianoRollComponent.layoutNotes (apps/web/src/app/features/editor/sound/piano-roll.component.ts:203:9)',
      'at PianoRollComponent.layoutNotes (apps/web/src/app/features/editor/sound/piano-roll.component.ts:219:14)',
      'at PianoRollComponent.layoutNotes (apps/web/src/app/features/editor/sound/piano-roll.component.ts:219:14)',
    ],
    routes: ['/edit/:id/sound'],
    count: 5,
    status: 'NEW',
    firstDaysAgo: 3,
    lastHoursAgo: 11,
  },
  {
    source: 'WEB',
    name: 'NG0100',
    message: 'ExpressionChangedAfterItHasBeenCheckedError: previous value "false", current "true"',
    stack: [
      'at ConsentBannerComponent (apps/web/src/app/shared/consent/consent-banner.component.html:3:7)',
    ],
    routes: ['/hub', '/play/:id', '/learn'],
    count: 1290,
    status: 'IGNORED',
    firstDaysAgo: 60,
    lastHoursAgo: 3,
    adminNote: 'Development builds only, harmless.',
  },
  {
    source: 'ENGINE',
    name: 'LuaVmFault',
    message: 'fengari: stack overflow in the VM (C stack overflow)',
    stack: [
      'at luaD_growstack (node_modules/fengari/src/ldo.js:118:9)',
      'at LuaRuntime.call (packages/engine/src/lua/LuaRuntime.ts:92:14)',
      'at Engine.update (packages/engine/src/Engine.ts:312:20)',
    ],
    routes: ['/play/:id'],
    count: 14,
    status: 'RESOLVED',
    firstDaysAgo: 33,
    lastHoursAgo: 190,
    adminNote: 'Runaway recursion in a game now ends as a Lua error instead of a VM fault.',
    extra: { fault: 'lua-vm' },
  },
  {
    source: 'BACKEND',
    name: 'TypeError',
    message: "Cannot read properties of null (reading 'hostId')",
    stack: [
      'at WorkSessionService.electHost (src/routes/work-session/work-session.service.ts:188:36)',
      'at WorkSessionGateway.onLeave (src/routes/work-session/work-session.gateway.ts:74:7)',
    ],
    routes: ['WS /work-session'],
    count: 2,
    status: 'NEW',
    firstDaysAgo: 1,
    lastHoursAgo: 4,
  },
];

const OCCURRENCES_SHOWN = 6;

async function seedCrashes(prisma: PrismaClient): Promise<number> {
  for (const crash of CRASHES) {
    const createdAt = daysAgo(crash.firstDaysAgo);
    const lastSeen = hoursAgo(crash.lastHoursAgo);
    const stack = `${crash.name}: ${crash.message}\n${crash.stack.map((line) => `    ${line}`).join('\n')}`;
    const occurrences = Math.min(crash.count, OCCURRENCES_SHOWN);
    const span = lastSeen.getTime() - createdAt.getTime();
    await prisma.report.create({
      data: {
        kind: 'CRASH',
        status: crash.status,
        source: crash.source,
        title: crash.name,
        message: crash.message,
        groupKey: crashGroupKey(crash.source, crash.name, crash.message),
        stack,
        count: crash.count,
        lastSeen,
        regressedAt:
          crash.regressedHoursAgo === undefined ? null : hoursAgo(crash.regressedHoursAgo),
        adminNote: crash.adminNote ?? null,
        appRelease: releaseAt(lastSeen),
        createdAt,
        updatedAt: lastSeen,
        occurrences: {
          create: Array.from({ length: occurrences }, (_, index) => {
            const at = new Date(
              lastSeen.getTime() - Math.round((span / 40) * (occurrences - 1 - index)),
            );
            return {
              createdAt: at,
              route: pick(crash.routes),
              stack,
              appRelease: releaseAt(at),
              ...(crash.source === 'BACKEND'
                ? {}
                : { ...pick(DEVICES), ...(crash.extra ? { extra: crash.extra } : {}) }),
            };
          }),
        },
      },
    });
  }
  return CRASHES.length;
}

export async function seedSupport(
  prisma: PrismaClient,
  accounts: Accounts,
  games: Games,
): Promise<string> {
  const raters = await prisma.user.findMany({
    where: { role: 'User', deletedAt: null },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  const published = await prisma.project.findMany({
    where: { publishedAt: { not: null }, hiddenAt: null },
    select: { id: true },
  });
  const ratings = await seedRatings(
    prisma,
    raters.map((rater) => rater.id),
    published.map((project) => project.id),
  );
  const bugs = await seedBugs(prisma, accounts, games, ratings);
  const crashes = await seedCrashes(prisma);
  return `${String(ratings.length)} ratings, ${String(bugs)} bug reports, ${String(crashes)} crashes`;
}
