// Logs go to stdout (docker logs) AND to the service_logs table, so they can be
// browsed from the admin panel without SSH access to the VM.
import { db } from './db.js';
import { config } from './config.js';

const LEVELS = ['debug', 'info', 'warn', 'error'];
let lastPrune = 0;

function prune() {
  const nowMs = Date.now();
  if (nowMs - lastPrune < 60 * 60 * 1000) return;
  lastPrune = nowMs;
  const cutoff = new Date(nowMs - config.logRetentionDays * 86400 * 1000).toISOString();
  db().prepare('DELETE FROM service_logs WHERE ts < ?').run(cutoff);
}

export function createLogger(service) {
  const write = (level, message, context) => {
    const line = `[${new Date().toISOString()}] [${service}] ${level.toUpperCase()} ${message}`;
    (level === 'error' || level === 'warn' ? console.error : console.log)(
      context ? `${line} ${JSON.stringify(context)}` : line,
    );
    if (level === 'debug') return;
    try {
      db()
        .prepare('INSERT INTO service_logs (service, level, message, context) VALUES (?, ?, ?, ?)')
        .run(service, level, message, context ? JSON.stringify(context) : null);
      prune();
    } catch (err) {
      console.error(`[${service}] failed to persist log: ${err.message}`);
    }
  };
  return Object.fromEntries(LEVELS.map((level) => [level, (msg, ctx) => write(level, msg, ctx)]));
}
