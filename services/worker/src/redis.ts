import IORedis from 'ioredis';
import { loadRootEnv } from '@grossline/core';

export function createRedis(): IORedis {
  loadRootEnv();
  let url = process.env.REDIS_URL;
  if (!url) {
    // Outside production, fall back to the docker-compose default so a fresh
    // clone can run `pnpm verify` before writing a .env.
    if (process.env.NODE_ENV === 'production') throw new Error('REDIS_URL is not set');
    url = 'redis://localhost:6380';
  }
  // BullMQ requires maxRetriesPerRequest: null on its connections.
  return new IORedis(url, { maxRetriesPerRequest: null });
}

/** Key prefix so test runs never collide with a locally running worker. */
export function queuePrefix(): string {
  return process.env.BULLMQ_PREFIX ?? (process.env.NODE_ENV === 'test' ? 'grossline-test' : 'grossline');
}
