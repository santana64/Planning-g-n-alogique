'use client';

import { useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { signOut } from '@/lib/auth-client';

export function SignOutButton({ label, returnTo = '/' }: { label: string; returnTo?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        await signOut();
        startTransition(() => {
          router.push(returnTo);
          // Without refresh the server components keep the cached session and
          // the user appears signed in until the next hard navigation.
          router.refresh();
        });
      }}
      className="border-border-default text-text-secondary hover:border-border-strong hover:text-text-primary rounded-[var(--radius-md)] border px-3 py-1.5 text-sm transition-colors duration-[var(--duration-fast)] disabled:opacity-60"
    >
      {label}
    </button>
  );
}
