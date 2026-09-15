'use client';

import { createAuthClient } from 'better-auth/react';

/**
 * Browser-side auth client.
 *
 * No baseURL: the client talks to the same origin it was served from, which
 * means a preview deployment or a local tunnel works without reconfiguration.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
