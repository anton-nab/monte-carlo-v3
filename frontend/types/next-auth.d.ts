/**
 * Augment NextAuth default types to include `userId` (GitHub providerAccountId).
 * This field is set in the jwt + session callbacks in [...nextauth].ts.
 */
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    /** GitHub numeric user ID (string form of providerAccountId) */
    userId: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId: string;
  }
}
