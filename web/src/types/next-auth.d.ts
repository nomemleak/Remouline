import 'next-auth';
import 'next-auth/jwt';

type Role = 'student' | 'maintainer' | 'operator';

declare module 'next-auth' {
  interface Session {
    user: { login: string; role: Role };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    login?: string;
    role?: Role;
  }
}
