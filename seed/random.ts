export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** mulberry32, so two runs of the seed write the same people saying the same things. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const random = generator(211);

export function chance(probability: number): boolean {
  return random() < probability;
}

export function between(low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

export function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) {
    throw new Error('pick from an empty list');
  }
  return item;
}

export function sample<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const taken: T[] = [];
  while (taken.length < count && pool.length > 0) {
    taken.push(...pool.splice(Math.floor(random() * pool.length), 1));
  }
  return taken;
}

export function weighted<T>(items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  let left = random() * total;
  for (const [item, weight] of items) {
    left -= weight;
    if (left <= 0) {
      return item;
    }
  }
  return pick(items)[0];
}

/** Every date the seed writes is counted back from the moment it runs. */
const NOW = Date.now();

export function now(): Date {
  return new Date(NOW);
}

export function daysAgo(days: number, extraHours = 0): Date {
  return new Date(NOW - days * DAY_MS - extraHours * HOUR_MS);
}

export function hoursAgo(hours: number): Date {
  return new Date(NOW - hours * HOUR_MS);
}

export function after(date: Date, milliseconds: number): Date {
  return new Date(Math.min(date.getTime() + milliseconds, NOW));
}
