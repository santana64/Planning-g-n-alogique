'use server';

import { getLocale, getTranslations } from 'next-intl/server';
import { TREE_ROLES, type TreeRole } from '@chronolignee/domain';
import {
  INVITATION_TTL_DAYS,
  MembershipRefused,
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  removeMember,
  revokeInvitation,
} from '@chronolignee/db';
import { treeInvitationMessage } from '@chronolignee/mail';
import { getPathname, redirect } from '@/i18n/navigation';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { sendMail } from '@/lib/mail';
import { getSession } from '@/lib/session';
import type { ActionState } from './action-state';
import { resolveTreeAccess } from './access';
import { authoriseWrite } from './authorise';
import { revalidateDashboard, revalidateTree } from './revalidate';
import type { InviteState } from './sharing-state';

/**
 * Inviting, changing roles, removing, leaving, joining.
 *
 * Authorised twice, on purpose: here by capability — may this account manage
 * members at all — and in the service, inside the transaction, by the rule
 * about whose role may become what, against the roles as they are at that
 * instant.
 */

async function failure(error: unknown): Promise<ActionState> {
  const t = await getTranslations('actions');
  if (error instanceof MembershipRefused) {
    return { status: 'error', message: t(`sharing.refusal.${error.code}`) };
  }
  // Nothing from the database reaches the page, nor the log beyond the
  // error's name: a Prisma message can quote an address or a name.
  logger.error(
    { event: 'membership.failed', error: error instanceof Error ? error.name : typeof error },
    'membership change failed',
  );
  return { status: 'error', message: t('sharing.changeFailed') };
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function roleFrom(form: FormData): TreeRole | null {
  const value = text(form, 'role');
  return (TREE_ROLES as readonly string[]).includes(value) ? (value as TreeRole) : null;
}

export async function inviteMemberAction(
  _previous: InviteState,
  form: FormData,
): Promise<InviteState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'manageMembers');
  if ('error' in authorised) return authorised.error;

  const role = roleFrom(form);
  if (!role) return { status: 'error', message: t('sharing.chooseRole') };
  const email = text(form, 'email');

  try {
    const created = await createInvitation(
      db,
      { treeId: authorised.access.treeId, email, role },
      { userId: authorised.userId },
    );
    const locale = await getLocale();
    const path = getPathname({ href: `/invitation/${created.token}`, locale });
    const link = new URL(path, env.APP_URL).toString();

    // Sent when the instance can send, and shown either way: the link is what
    // the inviter can pass on by whatever channel the family already uses,
    // and a message that never arrives must not leave them with nothing.
    const sent = await sendMail(
      'tree-invitation',
      treeInvitationMessage({
        to: email,
        url: link,
        treeName: authorised.access.treeName,
        inviterName: authorised.userName,
        // The inviter's language: it is the only one this request knows.
        roleLabel: (await getTranslations('tree.roles'))(role),
        validForDays: INVITATION_TTL_DAYS,
        // The person invited may not have an account yet: the inviter's
        // language is the only one this request knows, like the link's.
        locale: locale === 'en' ? 'en' : 'fr',
      }),
    );

    revalidateTree(treeSlug);
    return {
      status: 'success',
      message: t(sent ? 'sharing.invitationSent' : 'sharing.invitationReady', {
        email: email.toLowerCase(),
      }),
      link,
      expiresAt: created.expiresAt.toISOString(),
    };
  } catch (error) {
    return await failure(error);
  }
}

export async function revokeInvitationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'manageMembers');
  if ('error' in authorised) return authorised.error;

  try {
    await revokeInvitation(
      db,
      { treeId: authorised.access.treeId, invitationId: text(form, 'invitationId') },
      { userId: authorised.userId },
    );
    revalidateTree(treeSlug);
    return { status: 'success', message: t('sharing.invitationRevoked') };
  } catch (error) {
    return await failure(error);
  }
}

export async function changeRoleAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'manageMembers');
  if ('error' in authorised) return authorised.error;

  const role = roleFrom(form);
  if (!role) return { status: 'error', message: t('sharing.chooseRole') };

  try {
    await changeMemberRole(
      db,
      { treeId: authorised.access.treeId, memberId: text(form, 'memberId'), role },
      { userId: authorised.userId },
    );
    revalidateTree(treeSlug);
    return { status: 'success', message: t('sharing.roleChanged') };
  } catch (error) {
    return await failure(error);
  }
}

export async function removeMemberAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'manageMembers');
  if ('error' in authorised) return authorised.error;

  try {
    await removeMember(
      db,
      { treeId: authorised.access.treeId, memberId: text(form, 'memberId') },
      { userId: authorised.userId },
    );
    revalidateTree(treeSlug);
    return { status: 'success', message: t('sharing.memberRemoved') };
  } catch (error) {
    return await failure(error);
  }
}

/** Anyone may leave, whatever their role, as long as an owner remains. */
export async function leaveTreeAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const session = await getSession();
  const access = session ? await resolveTreeAccess(treeSlug) : null;
  if (!session || !access || access.role === null) {
    return { status: 'error', message: t('sharing.notAMember') };
  }

  const membership = await db.treeMember.findUnique({
    where: { treeId_userId: { treeId: access.treeId, userId: session.user.id } },
    select: { id: true },
  });
  if (!membership) return { status: 'error', message: t('sharing.notAMember') };

  try {
    await removeMember(
      db,
      { treeId: access.treeId, memberId: membership.id },
      { userId: session.user.id },
    );
  } catch (error) {
    return await failure(error);
  }
  revalidateTree(treeSlug);
  revalidateDashboard();
  redirect({ href: '/app', locale: await getLocale() });
  // Not reached: redirect throws. Typed as returning, so said explicitly.
  return { status: 'success' };
}

export async function acceptInvitationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const session = await getSession();
  if (!session) return { status: 'error', message: t('sharing.signInToAccept') };

  let treeSlug: string;
  try {
    const joined = await acceptInvitation(db, {
      token: text(form, 'token'),
      userId: session.user.id,
    });
    treeSlug = joined.treeSlug;
  } catch (error) {
    return await failure(error);
  }
  logger.info({ event: 'membership.joined', userId: session.user.id }, 'invitation accepted');
  revalidateTree(treeSlug);
  revalidateDashboard();
  redirect({ href: `/app/${treeSlug}/personnes`, locale: await getLocale() });
  // Not reached: redirect throws. Typed as returning, so said explicitly.
  return { status: 'success' };
}
