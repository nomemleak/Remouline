// LOCAL MOCK MODE - for trying the UI without the Git server nor the API.
//
// Enabled ONLY when both are true:
//   - NODE_ENV === 'development'  (i.e. `next dev`; `next build` is always 'production')
//   - REMOULINE_MOCK === '1'      (set by `npm run dev:mock`)
// Next.js inlines NODE_ENV at build time, so in a production build this constant is
// `false` and every mock branch is dead code: it cannot be switched on by an env var.
export const MOCK_MODE = process.env.NODE_ENV === 'development' && process.env.REMOULINE_MOCK === '1';

export const MOCK_COOKIE = 'remouline-mock-user';

export type Role = 'student' | 'maintainer' | 'operator';

export const MOCK_USERS = {
  student: { login: 'mock.student', role: 'student' as Role },
  other: { login: 'mock.other', role: 'student' as Role },
  maintainer: { login: 'm-demo42', role: 'maintainer' as Role },
  operator: { login: 'operator', role: 'operator' as Role },
} as const;

export type MockUser = keyof typeof MOCK_USERS;
