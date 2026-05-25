/**
 * pages/api/auth/[...nextauth].ts
 * ─────────────────────────────────
 * NextAuth.js v4 — GitHub OAuth, JWT strategy.
 *
 * JWT strategy = sessions are signed cookies, no DB tables needed for auth.
 * user.id in the session = GitHub providerAccountId (the GitHub numeric user ID).
 *
 * Required env vars:
 *   NEXTAUTH_URL     — canonical URL (https://your-app.vercel.app)
 *   NEXTAUTH_SECRET  — random secret (openssl rand -base64 32)
 *   GITHUB_CLIENT_ID
 *   GITHUB_CLIENT_SECRET
 *
 * GitHub OAuth App callback URL:
 *   https://<your-app>.vercel.app/api/auth/callback/github
 */

import NextAuth, { type NextAuthOptions } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId:     process.env.GITHUB_CLIENT_ID     ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    }),
  ],

  session: {
    strategy: 'jwt',
    maxAge:   30 * 24 * 60 * 60, // 30 days
  },

  callbacks: {
    /**
     * Persist the GitHub numeric user ID in the JWT token.
     * account is only available on initial sign-in.
     */
    jwt({ token, account }) {
      if (account?.providerAccountId) {
        token.userId = account.providerAccountId;
      }
      return token;
    },

    /**
     * Expose userId on the client-side session object.
     */
    session({ session, token }) {
      if (token.userId) {
        session.userId = token.userId as string;
      }
      return session;
    },
  },

  pages: {
    signIn: '/api/auth/signin',   // default NextAuth sign-in page
  },
};

export default NextAuth(authOptions);
