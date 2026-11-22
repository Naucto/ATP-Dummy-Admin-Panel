function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export type SeedMode = 'reset' | 'once';

function seedMode(): SeedMode {
  const mode = optional('SEED_MODE', 'reset');
  if (mode !== 'reset' && mode !== 'once') {
    throw new Error(`SEED_MODE is "${mode}", expected "reset" or "once"`);
  }
  return mode;
}

interface Operator {
  login: string;
  password: string;
}

/** The admin account of whoever runs the stack, when USERNAME and PASSWORD name one. */
function operator(): Operator | null {
  const login = process.env['USERNAME']?.trim();
  const password = process.env['PASSWORD'];
  if (!login && !password) {
    return null;
  }
  if (!login || !password) {
    throw new Error('USERNAME and PASSWORD go together: set both or neither');
  }
  return { login, password };
}

/** Every seeded account has an address on this domain, which no mail server answers for. */
export const SEED_DOMAIN = 'naucto-dummy.test';

export const config = {
  databaseUrl: required('DATABASE_URL'),
  mode: seedMode(),
  password: optional('SEED_PASSWORD', 'Naucto!dummy1'),
  operator: operator(),
  storage: {
    endpoint: required('S3_ENDPOINT'),
    region: optional('S3_REGION', 'us-east-1'),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    bucket: required('S3_BUCKET_NAME'),
  },
  edgeEndpoint: required('EDGE_ENDPOINT').replace(/\/+$/, ''),
};
