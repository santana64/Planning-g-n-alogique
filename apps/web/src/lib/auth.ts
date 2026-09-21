import 'server-only';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { emailVerificationMessage, passwordResetMessage } from '@chronolignee/mail';
import { db } from './db';
import { env } from './env';
import { mailEnabled, sendMail } from './mail';

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
/** An hour, like the reset link everyone is used to. */
const RESET_VALID_SECONDS = 60 * 60;
/** A day: a confirmation often waits until the evening. */
const VERIFICATION_VALID_SECONDS = 60 * 60 * 24;

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
    // Only where an address can actually be confirmed. Requiring a
    // verification that no transport can deliver would lock everyone out of
    // an instance that simply has no mail provider (see docs/SECURITY.md).
    requireEmailVerification: mailEnabled,
    autoSignIn: true,
    resetPasswordTokenExpiresIn: RESET_VALID_SECONDS,
    sendResetPassword: async ({ user, url }) => {
      await sendMail(
        'password-reset',
        passwordResetMessage({ to: user.email, url, validForHours: RESET_VALID_SECONDS / 3600 }),
      );
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    // A sign-in attempt on an unconfirmed address sends the link again: the
    // first message is the one that gets lost, and asking someone to find a
    // "resend" button is asking them to give up.
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: VERIFICATION_VALID_SECONDS,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail('email-verification', emailVerificationMessage({ to: user.email, url }));
    },
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
      // Deliberately looser than sign-in. Sign-up is limited per IP, and a
      // genealogy is something a family does together: relatives creating
      // accounts from one household — or one office, one library, one
      // retirement home behind a single NAT — are the normal case, not an
      // attack. Twenty an hour still stops bulk registration cold while
      // leaving room for the gathering this product exists to serve.
      '/sign-up/email': { window: 3600, max: 20 },
      '/forget-password': { window: 3600, max: 3 },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
