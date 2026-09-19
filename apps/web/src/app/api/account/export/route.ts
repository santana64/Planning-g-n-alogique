import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';

/**
 * Everything this instance holds about the account itself, as JSON.
 *
 * The right of access and portability, for the account: profile,
 * memberships, invitations sent, sessions with the addresses and browsers
 * they were opened from. The trees are the family's research rather than the
 * account's, and leave as GEDCOM from their own settings.
 */
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const userId = session.user.id;

  const [user, memberships, invitations, sessions] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        emailVerified: true,
        createdAt: true,
        displayLocale: true,
      },
    }),
    db.treeMember.findMany({
      where: { userId, tree: { deletedAt: null } },
      select: { role: true, joinedAt: true, tree: { select: { name: true, slug: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    db.treeInvitation.findMany({
      where: { invitedById: userId },
      select: {
        email: true,
        role: true,
        createdAt: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        tree: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.session.findMany({
      where: { userId },
      select: { createdAt: true, expiresAt: true, ipAddress: true, userAgent: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const body = {
    exportedAt: new Date().toISOString(),
    account: user,
    memberships: memberships.map((membership) => ({
      tree: membership.tree.name,
      slug: membership.tree.slug,
      role: membership.role,
      joinedAt: membership.joinedAt,
    })),
    invitationsSent: invitations.map((invitation) => ({
      tree: invitation.tree.name,
      email: invitation.email,
      role: invitation.role,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      status: invitation.revokedAt
        ? 'revoked'
        : invitation.acceptedAt
          ? 'accepted'
          : invitation.expiresAt.getTime() <= Date.now()
            ? 'expired'
            : 'pending',
    })),
    sessions,
    trees:
      'Les arbres s’exportent au format GEDCOM depuis leurs réglages, par leur propriétaire ou leurs administrateurs.',
  };

  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="chronolignee-compte-${day}.json"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
