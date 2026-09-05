import IORedis from 'ioredis';
import { loadRootEnv } from '@grossline/core';

export function createRedis(): IORedis {
  loadRootEnv();
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  // BullMQ requires maxRetriesPerRequest: null on its connections.
  return new IORedis(url, { maxRetriesPerRequest: null });
}

/** Key prefix so test runs never collide with a locally running worker. */
export function queuePrefix(): string {
  return process.env.BULLMQ_PREFIX ?? (process.env.NODE_ENV === 'test' ? 'grossline-test' : 'grossline');
}
