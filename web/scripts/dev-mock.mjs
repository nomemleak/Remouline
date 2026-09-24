// `npm run dev:mock`: starts `next dev` in local mock mode (fake users, fake data,
// no Git server / API needed). Works on Windows, macOS and Linux.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

const child = spawn(process.execPath, [nextBin, 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    REMOULINE_MOCK: '1',
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || '.next-mock',
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || 'local-mock-only',
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
