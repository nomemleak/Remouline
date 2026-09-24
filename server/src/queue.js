// Redis-backed job queue (BullMQ). Any number of worker processes, on this VM or
// another one later, can consume the same queue: scaling out = starting more workers.
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config.js';

let connection;
let queue;

export function redis() {
  if (!connection) {
    connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function correctionQueue() {
  if (!queue) {
    queue = new Queue(config.queueName, {
      connection: redis(),
      defaultJobOptions: {
        attempts: 1, // retries are an explicit admin action ("Re-run"), never automatic
        removeOnComplete: { age: 7 * 86400, count: 5000 },
        removeOnFail: { age: 30 * 86400 },
      },
    });
  }
  return queue;
}

/**
 * Job payloads:
 *   { type: 'push', submissionId }                       - student push, needs clone + slug resolution
 *   { type: 'validation', submissionId, slug, role }     - reference implementation (correct | broken)
 */
export async function enqueueSubmission(payload) {
  const suffix = payload.attempt && payload.attempt > 1 ? `-r${payload.attempt}` : '';
  await correctionQueue().add(payload.type, payload, { jobId: `sub-${payload.submissionId}${suffix}` });
}
