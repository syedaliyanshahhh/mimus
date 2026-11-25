'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { createCompany, type OnboardingState } from './actions';

const INPUT =
  'w-full rounded-md border border-line-muted bg-paper px-3 py-2 text-sm text-ink focus:border-ink-faint focus:outline-none';

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(createCompany, {
    error: null,
  });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-ink">
        Company name
        <input
          name="companyName"
          required
          maxLength={100}
          autoComplete="organization"
          className={INPUT}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink">
        Workspace name
        <input
          name="workspaceName"
          required
          maxLength={100}
          defaultValue="General"
          className={INPUT}
        />
        <span className="text-xs text-ink-muted">
          A workspace is a team inside your company. You can add more later.
        </span>
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create company'}
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
