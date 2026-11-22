import { setTimeout as sleep } from 'node:timers/promises';

import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { config } from './config';

/** The object whose presence says this seed filled the bucket. */
const MARKER_KEY = '.naucto-dummy';
/** What the web app reads straight from the edge. Screenshots and withheld games stay private. */
const PUBLIC_PREFIXES = ['release', 'projects', 'users'];

const ATTEMPTS = 60;
const ATTEMPT_DELAY_MS = 2_000;

const bucket = config.storage.bucket;
const client = new S3Client({
  region: config.storage.region,
  endpoint: config.storage.endpoint,
  credentials: {
    accessKeyId: config.storage.accessKeyId,
    secretAccessKey: config.storage.secretAccessKey,
  },
  forcePathStyle: true,
});

function statusOf(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}

async function bucketExists(): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return true;
    } catch (error) {
      if (statusOf(error) === 404) {
        return false;
      }
      if (attempt === ATTEMPTS) {
        throw error;
      }
      await sleep(ATTEMPT_DELAY_MS);
    }
  }
}

async function exists(key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (statusOf(error) === 404) {
      return false;
    }
    throw error;
  }
}

async function listKeys(limit?: number): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: limit }),
    );
    keys.push(...(page.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : [])));
    token = limit === undefined ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export type BucketState = 'empty' | 'seeded' | 'foreign';

/**
 * Whose objects the bucket holds, waiting for the storage to answer first. A bucket with objects
 * and without the marker was filled by something else, and the seed never empties it.
 */
export async function bucketState(): Promise<BucketState> {
  if (!(await bucketExists())) {
    return 'empty';
  }
  if (await exists(MARKER_KEY)) {
    return 'seeded';
  }
  return (await listKeys(1)).length === 0 ? 'empty' : 'foreign';
}

/** Leaves an empty bucket that serves the public prefixes to anyone and holds the marker. */
export async function resetBucket(): Promise<void> {
  if (await bucketExists()) {
    const keys = await listKeys();
    for (let start = 0; start < keys.length; start += 1000) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.slice(start, start + 1000).map((key) => ({ Key: key })) },
        }),
      );
    }
  } else {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  await client.send(
    new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: PUBLIC_PREFIXES.map((prefix) => `arn:aws:s3:::${bucket}/${prefix}/*`),
          },
        ],
      }),
    }),
  );
  await put(MARKER_KEY, Buffer.from('Filled by the Naucto dummy seed.\n'), 'text/plain');
}

export async function put(
  key: string,
  body: Buffer,
  contentType: string,
  cacheControl?: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );
}

export function publicUrl(key: string): string {
  return `${config.edgeEndpoint}/${key}`;
}
