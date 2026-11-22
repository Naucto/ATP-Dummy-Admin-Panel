import type {
  ModerationActionType,
  ModerationReason,
  ModerationTargetType,
  PrismaClient,
} from '@prisma/client';

import type { Accounts } from './accounts';
import type { Games } from './games';
import { after, DAY_MS, daysAgo, HOUR_MS, hoursAgo, MINUTE_MS } from './random';

/**
 * Whether the account an action bore on finds it in its standing, as `ModerationLogService`
 * decides it per kind of action.
 */
const VISIBLE_TO_SUBJECT: Record<ModerationActionType, boolean> = {
  ACCOUNT_WARNED: true,
  ACCOUNT_SUSPENDED: true,
  ACCOUNT_REINSTATED: true,
  ACCOUNT_DELETED: false,
  PROFILE_CLEARED: true,
  ROLE_CHANGED: false,
  PROJECT_HIDDEN: true,
  PROJECT_RESTORED: true,
  PROJECT_DELETED: true,
  COMMENT_HIDDEN: true,
  COMMENT_RESTORED: true,
  COMMENT_DELETED: true,
  FLAGS_DISMISSED: false,
  DRAFT_VIEWED: false,
};

/** What the account is told when a moderator gave no message of their own. */
const NOTICES: Partial<Record<ModerationActionType, [title: string, fallback: string]>> = {
  ACCOUNT_WARNED: ['You received a warning', ''],
  ACCOUNT_SUSPENDED: ['Your account is suspended', ''],
  ACCOUNT_REINSTATED: ['Your account is reinstated', 'Your suspension was lifted.'],
  PROFILE_CLEARED: ['Your profile was edited', 'A moderator removed part of your profile.'],
  PROJECT_HIDDEN: ['Your game was hidden', 'A moderator took one of your games off the hub.'],
  PROJECT_RESTORED: ['Your game is back', 'A moderator put one of your games back on the hub.'],
  PROJECT_DELETED: ['Your game was deleted', 'A moderator deleted one of your games.'],
  COMMENT_HIDDEN: ['Your comment was removed', 'A moderator removed one of your comments.'],
  COMMENT_RESTORED: ['Your comment is back', 'A moderator restored one of your comments.'],
  COMMENT_DELETED: ['Your comment was deleted', 'A moderator deleted one of your comments.'],
};

interface Content {
  title: string | null;
  body: string | null;
}

interface Target {
  type: ModerationTargetType;
  id: number;
  owner: number;
  content: Content;
}

interface SeedFlag {
  reporter: string;
  reason: ModerationReason;
  details?: string;
  at: Date;
}

interface Decision {
  action: ModerationActionType;
  actor: string;
  at: Date;
  reason?: ModerationReason;
  publicMessage?: string;
  internalNote?: string;
  expiresAt?: Date;
  /** How the open flags on the target end with this decision. */
  settles?: 'ACTIONED' | 'DISMISSED';
  withoutSnapshot?: boolean;
  dedupeKey?: string;
}

class ModerationSeed {
  flags = 0;
  actions = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly accounts: Accounts,
    private readonly games: Games,
  ) {}

  async account(username: string): Promise<Target> {
    const id = this.accounts.id(username);
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: { username: true, nickname: true, description: true },
    });
    return {
      type: 'USER',
      id,
      owner: id,
      content: { title: row.nickname ?? row.username, body: row.description },
    };
  }

  async game(key: string): Promise<Target> {
    const row = await this.prisma.project.findUniqueOrThrow({
      where: { id: this.games.id(key) },
      select: { id: true, userId: true, name: true, shortDesc: true, longDesc: true },
    });
    const body = [row.shortDesc, row.longDesc].filter(Boolean).join('\n\n');
    return {
      type: 'PROJECT',
      id: row.id,
      owner: row.userId,
      content: { title: row.name, body: body || null },
    };
  }

  /** `saidThen` is what the comment read when it was reported, where it reads otherwise now. */
  async comment(key: string, saidThen?: string): Promise<Target> {
    const row = await this.prisma.comment.findUniqueOrThrow({
      where: { id: this.games.comment(key) },
      select: { id: true, authorId: true, content: true },
    });
    return {
      type: 'COMMENT',
      id: row.id,
      owner: row.authorId,
      content: { title: null, body: saidThen ?? row.content },
    };
  }

  async report(target: Target, flags: SeedFlag[]): Promise<void> {
    for (const flag of flags) {
      const reporterId = this.accounts.id(flag.reporter);
      await this.prisma.flag.create({
        data: {
          reporterId,
          targetType: target.type,
          targetId: target.id,
          targetOwnerId: target.owner,
          reason: flag.reason,
          details: flag.details ?? null,
          snapshot: { ...target.content },
          openKey: `${String(reporterId)}:${target.type}:${String(target.id)}`,
          createdAt: flag.at,
        },
      });
      this.flags += 1;
    }
  }

  async decide(target: Target, decision: Decision): Promise<void> {
    const actorId = this.accounts.id(decision.actor);
    const row = await this.prisma.moderationAction.create({
      data: {
        action: decision.action,
        actorId,
        targetType: target.type,
        targetId: target.id,
        subjectUserId: target.owner,
        reason: decision.reason ?? null,
        publicMessage: decision.publicMessage ?? null,
        internalNote: decision.internalNote ?? null,
        ...(decision.withoutSnapshot ? {} : { snapshot: { ...target.content } }),
        expiresAt: decision.expiresAt ?? null,
        visibleToSubject: VISIBLE_TO_SUBJECT[decision.action],
        dedupeKey: decision.dedupeKey ?? null,
        createdAt: decision.at,
      },
      select: { id: true },
    });
    this.actions += 1;

    if (decision.settles) {
      await this.prisma.flag.updateMany({
        where: { targetType: target.type, targetId: target.id, status: 'OPEN' },
        data: {
          status: decision.settles,
          openKey: null,
          resolvedById: actorId,
          resolvedAt: decision.at,
          resolutionId: row.id,
        },
      });
    }

    const notice = NOTICES[decision.action];
    if (notice) {
      await this.prisma.notification.create({
        data: {
          userId: target.owner,
          title: notice[0],
          message: decision.publicMessage || notice[1],
          type: 'WARNING',
          kind: 'MODERATION',
          data: { actionId: row.id, action: decision.action },
          read: decision.at.getTime() < Date.now() - 7 * DAY_MS,
          createdAt: decision.at,
        },
      });
    }
  }
}

async function seedRoleChanges(seed: ModerationSeed): Promise<void> {
  const grants = [
    { username: 'moderator', role: 'Moderator', daysAgo: 118 },
    { username: 'camille', role: 'Moderator', daysAgo: 92 },
    { username: 'viewer', role: 'Viewer', daysAgo: 58 },
  ];
  for (const grant of grants) {
    await seed.decide(await seed.account(grant.username), {
      action: 'ROLE_CHANGED',
      actor: 'admin',
      at: daysAgo(grant.daysAgo),
      internalNote: `From User to ${grant.role}`,
      withoutSnapshot: true,
    });
  }
}

/** What staff already settled, oldest first, so the log and each account's record have a past. */
async function seedHistory(
  prisma: PrismaClient,
  accounts: Accounts,
  seed: ModerationSeed,
): Promise<void> {
  const larry = await seed.account('loud_larry');
  await seed.report(larry, [
    {
      reporter: 'marie',
      reason: 'HARASSMENT',
      details: 'Shouts at everyone in every comment thread.',
      at: daysAgo(42),
    },
  ]);
  const larrySuspendedAt = daysAgo(41);
  await seed.decide(larry, {
    action: 'ACCOUNT_SUSPENDED',
    actor: 'camille',
    at: larrySuspendedAt,
    reason: 'HARASSMENT',
    publicMessage: 'Suspended for a week for insulting other players in comments.',
    internalNote: 'First offence, a week is enough.',
    expiresAt: after(larrySuspendedAt, 7 * DAY_MS),
    settles: 'ACTIONED',
  });
  await seed.decide(larry, {
    action: 'ACCOUNT_REINSTATED',
    actor: 'admin',
    at: daysAgo(37),
    publicMessage: 'Your suspension was lifted early after your apology.',
    internalNote: 'Wrote in to apologise. Lifting three days early.',
  });

  const spamComment = await seed.comment('spam-on-snake');
  await seed.report(spamComment, [
    { reporter: 'ulysse', reason: 'SPAM', details: 'Phishing link.', at: daysAgo(32, 9) },
    { reporter: 'louis', reason: 'SPAM', at: daysAgo(32, 4) },
    {
      reporter: 'marie',
      reason: 'ILLEGAL',
      details: 'Asks for passwords.',
      at: daysAgo(32),
    },
  ]);
  await seed.decide(spamComment, {
    action: 'COMMENT_HIDDEN',
    actor: 'moderator',
    at: daysAgo(31),
    reason: 'SPAM',
    publicMessage: 'Your comment advertised a site that asks for passwords.',
    internalNote: 'Phishing. Watch this account.',
    settles: 'ACTIONED',
  });
  const freecoins = await seed.account('freecoins4u');
  await seed.decide(freecoins, {
    action: 'ACCOUNT_WARNED',
    actor: 'moderator',
    at: after(daysAgo(31), 4 * MINUTE_MS),
    reason: 'SPAM',
    publicMessage: 'Do not advertise sites that ask people for their password. Next time is a suspension.',
  });

  const ferry = await seed.game('ferry');
  await seed.report(ferry, [
    {
      reporter: 'copycat',
      reason: 'STOLEN_CONTENT',
      details: 'This is my game, I made it first.',
      at: daysAgo(28, 6),
    },
  ]);
  await seed.decide(ferry, {
    action: 'PROJECT_HIDDEN',
    actor: 'camille',
    at: daysAgo(28),
    reason: 'STOLEN_CONTENT',
    internalNote: 'Hiding while we compare the two.',
    settles: 'ACTIONED',
  });
  await seed.decide(ferry, {
    action: 'PROJECT_RESTORED',
    actor: 'admin',
    at: daysAgo(27),
    publicMessage: 'Sorry for the interruption: the report against your game was unfounded.',
    internalNote: 'The reporter joined after this game was published. Nothing stolen.',
  });

  const gusComment = await seed.comment(
    'gus-on-lander',
    'Only an idiot could fail to land this. Delete your account, kenza, you are worthless.',
  );
  await seed.report(gusComment, [
    { reporter: 'kenza', reason: 'HARASSMENT', details: 'Aimed at me by name.', at: daysAgo(24) },
    { reporter: 'thea', reason: 'HARASSMENT', at: daysAgo(23, 10) },
  ]);
  await seed.decide(gusComment, {
    action: 'COMMENT_DELETED',
    actor: 'camille',
    at: daysAgo(23),
    reason: 'HARASSMENT',
    publicMessage: 'Insulting another player by name is not allowed here.',
    settles: 'ACTIONED',
  });
  const gusThen = await seed.account('grumpy_gus');
  await seed.decide(gusThen, {
    action: 'ACCOUNT_WARNED',
    actor: 'camille',
    at: after(daysAgo(23), 6 * MINUTE_MS),
    reason: 'HARASSMENT',
    publicMessage: 'Criticise games as much as you like, never the people who play them.',
  });

  const brawl = await seed.game('pixel-brawl');
  await seed.report(brawl, [
    {
      reporter: 'julien',
      reason: 'VIOLENCE',
      details: 'Skulls hitting each other.',
      at: daysAgo(13),
    },
  ]);
  await seed.decide(brawl, {
    action: 'FLAGS_DISMISSED',
    actor: 'moderator',
    at: daysAgo(12, 18),
    internalNote: 'Cartoon violence, well within the rules.',
    settles: 'DISMISSED',
  });

  const edgar = await seed.account('edgar');
  await seed.report(edgar, [
    {
      reporter: 'copycat',
      reason: 'IMPERSONATION',
      details: 'Pretends to be the real Edgar.',
      at: daysAgo(15),
    },
  ]);
  await seed.decide(edgar, {
    action: 'FLAGS_DISMISSED',
    actor: 'camille',
    at: daysAgo(14, 20),
    internalNote: 'He is the real Edgar.',
    settles: 'DISMISSED',
  });

  const speed = await seed.comment('speed-setting');
  await seed.report(speed, [
    { reporter: 'grumpy_gus', reason: 'OTHER', details: 'Bad opinion.', at: daysAgo(11) },
  ]);
  await seed.decide(speed, {
    action: 'COMMENT_HIDDEN',
    actor: 'moderator',
    at: daysAgo(10, 12),
    reason: 'OTHER',
    internalNote: 'Misclick, meant to dismiss.',
    settles: 'ACTIONED',
  });
  await seed.decide(speed, {
    action: 'COMMENT_RESTORED',
    actor: 'moderator',
    at: daysAgo(10, 11),
    publicMessage: 'Your comment was removed by mistake and is back. Sorry about that.',
  });

  const gusProfile: Target = {
    ...gusThen,
    content: { title: 'grumpy_gus', body: 'Everyone on this site is a talentless loser.' },
  };
  await seed.report(gusProfile, [
    { reporter: 'sacha', reason: 'HARASSMENT', details: 'His bio insults everybody.', at: daysAgo(9) },
  ]);
  await seed.decide(gusProfile, {
    action: 'PROFILE_CLEARED',
    actor: 'moderator',
    at: daysAgo(8, 20),
    reason: 'HARASSMENT',
    publicMessage: 'Your bio insulted other members and was removed. You can write a new one.',
    settles: 'ACTIONED',
  });
  await prisma.user.update({ where: { id: gusThen.id }, data: { description: null } });

  const doomed = await prisma.project.create({
    data: {
      name: 'Password Checker',
      shortDesc: 'Type your Naucto password to see how strong it is.',
      userId: accounts.id('gone_gary'),
      createdAt: daysAgo(22),
      publishedAt: daysAgo(22),
      publishedName: 'Password Checker',
    },
    select: { id: true, userId: true, name: true, shortDesc: true },
  });
  const doomedTarget: Target = {
    type: 'PROJECT',
    id: doomed.id,
    owner: doomed.userId,
    content: { title: doomed.name, body: doomed.shortDesc },
  };
  await seed.report(doomedTarget, [
    { reporter: 'alexis', reason: 'ILLEGAL', details: 'Collects passwords.', at: daysAgo(21, 8) },
    { reporter: 'vincent', reason: 'ILLEGAL', at: daysAgo(21, 5) },
  ]);
  await prisma.project.delete({ where: { id: doomed.id } });
  await seed.decide(doomedTarget, {
    action: 'PROJECT_DELETED',
    actor: 'admin',
    at: daysAgo(21),
    reason: 'ILLEGAL',
    publicMessage: 'Your game collected passwords and was deleted.',
    internalNote: 'Credential harvesting. Deleting the account as well.',
    settles: 'ACTIONED',
  });
  const gary = await seed.account('gone_gary');
  const garyId = accounts.id('gone_gary');
  await prisma.user.update({
    where: { id: garyId },
    data: {
      email: `deleted-${String(garyId)}-d0mm1e@deleted.naucto.invalid`,
      username: `deleted_${String(garyId)}_d0mm1e`,
      nickname: 'Deleted user',
      description: null,
      password: null,
      deletedAt: after(daysAgo(21), 10 * MINUTE_MS),
    },
  });
  await seed.decide(gary, {
    action: 'ACCOUNT_DELETED',
    actor: 'admin',
    at: after(daysAgo(21), 10 * MINUTE_MS),
    reason: 'ILLEGAL',
    internalNote: 'Account existed only to harvest passwords.',
    withoutSnapshot: true,
  });

  const freeCoins = await seed.game('free-coins');
  await seed.report(freeCoins, [
    { reporter: 'ulysse', reason: 'SPAM', details: 'Same phishing site again.', at: daysAgo(5, 20) },
    { reporter: 'thea', reason: 'SPAM', at: daysAgo(5, 14) },
    { reporter: 'alexis', reason: 'ILLEGAL', details: 'Asks for passwords.', at: daysAgo(5, 9) },
    { reporter: 'julien', reason: 'SPAM', at: daysAgo(5, 3) },
  ]);
  await seed.decide(freeCoins, {
    action: 'PROJECT_HIDDEN',
    actor: 'moderator',
    at: daysAgo(5),
    reason: 'SPAM',
    publicMessage: 'Your game sent players to a site that asks for their password.',
    internalNote: 'Second time. Asking an admin for a suspension.',
    settles: 'ACTIONED',
  });
  const freecoinsSuspendedAt = after(daysAgo(5), 2 * HOUR_MS);
  await prisma.user.update({
    where: { id: freecoins.id },
    data: { suspendedAt: freecoinsSuspendedAt, suspendedUntil: null },
  });
  await seed.decide(freecoins, {
    action: 'ACCOUNT_SUSPENDED',
    actor: 'admin',
    at: freecoinsSuspendedAt,
    reason: 'SPAM',
    publicMessage: 'Suspended for repeated phishing after a warning.',
    internalNote: 'Indefinite. Reinstate only if they write in.',
  });

  const gusNow = await seed.account('grumpy_gus');
  const gusSuspendedAt = daysAgo(3);
  const gusSuspendedUntil = new Date(gusSuspendedAt.getTime() + 14 * DAY_MS);
  await prisma.user.update({
    where: { id: gusNow.id },
    data: { suspendedAt: gusSuspendedAt, suspendedUntil: gusSuspendedUntil },
  });
  await seed.decide(gusNow, {
    action: 'ACCOUNT_SUSPENDED',
    actor: 'camille',
    at: gusSuspendedAt,
    reason: 'HARASSMENT',
    publicMessage: 'Two weeks off after a warning and a removed bio. Come back kinder.',
    internalNote: 'Third strike in a month.',
    expiresAt: gusSuspendedUntil,
  });

  const draft = await seed.game('roguelike');
  const viewedAt = hoursAgo(26);
  await seed.decide(
    { ...draft, content: { title: draft.content.title, body: null } },
    {
      action: 'DRAFT_VIEWED',
      actor: 'admin',
      at: viewedAt,
      dedupeKey: `view:${String(accounts.id('admin'))}:${String(draft.id)}:${String(Math.floor(viewedAt.getTime() / HOUR_MS))}`,
    },
  );
}

/** What is still waiting in the queue. */
async function seedOpenCases(seed: ModerationSeed): Promise<void> {
  await seed.report(await seed.game('lander-hd'), [
    {
      reporter: 'thea',
      reason: 'STOLEN_CONTENT',
      details: 'This is Moon Lander with my name removed. Same code, same sprites.',
      at: daysAgo(8),
    },
    { reporter: 'kenza', reason: 'STOLEN_CONTENT', details: 'Copy of Moon Lander.', at: daysAgo(6) },
    { reporter: 'alexis', reason: 'STOLEN_CONTENT', at: hoursAgo(30) },
  ]);
  await seed.report(await seed.comment('copycat-plug'), [
    { reporter: 'thea', reason: 'SPAM', details: 'Advertising the stolen copy.', at: daysAgo(7) },
  ]);
  await seed.report(await seed.account('loud_larry'), [
    {
      reporter: 'edgar',
      reason: 'HARASSMENT',
      details: 'Back at it after his suspension.',
      at: daysAgo(3),
    },
    { reporter: 'sacha', reason: 'HARASSMENT', at: hoursAgo(40) },
  ]);
  await seed.report(
    await seed.comment(
      'larry-on-duel',
      'EVERYONE WHO PLAYS THIS IS TRASH AND SHOULD GET OFF THIS SITE',
    ),
    [
      { reporter: 'louis', reason: 'HATE', details: 'He edited it after I reported.', at: daysAgo(4) },
      { reporter: 'edgar', reason: 'HARASSMENT', at: daysAgo(3, 20) },
    ],
  );
  await seed.report(await seed.game('snake-duo'), [
    {
      reporter: 'julien',
      reason: 'OTHER',
      details: 'Player two cannot turn left on my keyboard.',
      at: hoursAgo(9),
    },
  ]);
  await seed.report(await seed.account('freecoins4u'), [
    {
      reporter: 'vincent',
      reason: 'IMPERSONATION',
      details: 'Display name pretends to be an official giveaway.',
      at: hoursAgo(50),
    },
  ]);
}

export async function seedModeration(
  prisma: PrismaClient,
  accounts: Accounts,
  games: Games,
): Promise<string> {
  const seed = new ModerationSeed(prisma, accounts, games);
  await seedRoleChanges(seed);
  await seedHistory(prisma, accounts, seed);
  await seedOpenCases(seed);
  return `${String(seed.flags)} reports from users, ${String(seed.actions)} staff decisions`;
}
