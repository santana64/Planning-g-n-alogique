import 'server-only';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { db } from './db';
import { env } from './env';

/**
 * Authentication.
 *
 * Email and password to start, with the provider surface left open: passkeys,
 * Google, Apple and enterprise SSO are configuration here, not a rewrite.
 *
 * Two settings carry more weight than the rest:
 *
 *  - `generateId: false` hands id generation to PostgreSQL, which produces
 *    UUIDv7. The columns are typed `uuid`, so a library-generated string id
 *    would be rejected outright — and UUIDv7's time ordering is what keeps
 *    session and audit inserts local in the B-tree.
 *  - A twelve-character minimum password. Eight is the industry habit and is
 *    not defensible for an account that guards decades of a family's research
 *    and the personal data of living relatives.
 */
export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),

  appName: 'Chronolignée',
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: env.TRUSTED_ORIGINS.length > 0 ? env.TRUSTED_ORIGINS : [env.APP_URL],

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 256,
    // Verification is required before a tree can be shared; see docs/SECURITY.md.
    requireEmailVerification: false,
    autoSignIn: true,
  },

  user: {
    additionalFields: {
      displayLocale: {
        type: 'string',
        required: false,
        defaultValue: 'fr',
        input: false,
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      // Short enough that a revoked session stops working quickly, long enough
      // that ordinary navigation does not hit the database on every request.
      maxAge: 60 * 5,
    },
  },

  advanced: {
    database: {
      // PostgreSQL owns id generation. See the note above.
      generateId: false,
    },
    cookiePrefix: 'chronolignee',
    useSecureCookies: env.NODE_ENV === 'production',
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
    },
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
    customRules: {
      // Credential endpoints are the ones worth brute-forcing, so they get a
      // tighter budget than the rest of the auth surface.
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 3600, max: 5 },
      '/forget-password': { window: 3600, max: 3 },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
