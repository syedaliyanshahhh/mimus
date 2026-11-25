'use client';

import { Check, ChevronDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import type { WorkspaceMembership } from '@/src/server/workspaces/getCurrentWorkspaceContext';
import { SignOutButton } from '../sign-out-button';
import { switchWorkspaceAction } from './workspace-actions';

const LINKS = [
  { href: '/approvals', label: 'Approvals' },
  { href: '/settings/connections', label: 'Connections' },
  { href: '/settings/scheduling', label: 'Scheduling' },
  { href: '/members', label: 'Members' },
  { href: '/billing', label: 'Billing' },
  { href: '/feature-switches', label: 'Feature switches' },
  { href: '/audit-log', label: 'Audit log' },
  { href: '/settings/account', label: 'Account' },
];

// Groups memberships by company, keeping the oldest-first order.
function byCompany(memberships: WorkspaceMembership[]) {
  const groups = new Map<string, { companyName: string; workspaces: WorkspaceMembership[] }>();
  for (const membership of memberships) {
    const group = groups.get(membership.companyId) ?? {
      companyName: membership.companyName,
      workspaces: [],
    };
    group.workspaces.push(membership);
    groups.set(membership.companyId, group);
  }
  return [...groups.entries()];
}

export function AvatarMenu({
  initials,
  email,
  activeWorkspaceId,
  memberships,
}: {
  initials: string;
  email: string;
  activeWorkspaceId: string;
  memberships: WorkspaceMembership[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 rounded-full"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <Avatar initials={initials} />
        <ChevronDown className="size-4 text-ink-muted" />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-10 mt-2 max-h-[80vh] w-56 overflow-y-auto rounded-card border border-line-muted bg-paper-raised p-2 shadow-sm">
          <p className="truncate px-3 py-2 text-xs text-ink-faint">{email}</p>
          <nav aria-label="Workspaces" className="mb-2 border-b border-line-muted pb-2">
            {byCompany(memberships).map(([companyId, group]) => (
              <div key={companyId}>
                <p className="truncate px-3 pt-2 pb-1 text-xs font-medium text-ink-faint">
                  {group.companyName}
                </p>
                <ul className="flex flex-col">
                  {group.workspaces.map((workspace) => {
                    const current = workspace.workspaceId === activeWorkspaceId;
                    return (
                      <li key={workspace.workspaceId}>
                        <form action={switchWorkspaceAction}>
                          <input type="hidden" name="workspaceId" value={workspace.workspaceId} />
                          <button
                            type="submit"
                            disabled={current}
                            aria-current={current ? 'true' : undefined}
                            className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-ink-muted hover:bg-paper hover:text-ink disabled:cursor-default disabled:text-ink disabled:hover:bg-transparent"
                          >
                            <span className="truncate">{workspace.workspaceName}</span>
                            {current && <Check className="size-4 shrink-0" aria-hidden />}
                          </button>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <Link
              href="/onboarding"
              onClick={() => setOpen(false)}
              className="mt-1 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-muted hover:bg-paper hover:text-ink"
            >
              <Plus className="size-4" aria-hidden />
              Create a new company
            </Link>
          </nav>
          <ul className="flex flex-col">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-3 py-2 text-sm text-ink-muted hover:bg-paper hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-2 border-t border-line-muted pt-2">
            <SignOutButton />
          </div>
          <div className="mt-2 flex gap-3 border-t border-line-muted px-3 pt-2 text-xs text-ink-faint">
            <Link href="/privacy" onClick={() => setOpen(false)} className="hover:text-ink">
              Privacy
            </Link>
            <Link href="/terms" onClick={() => setOpen(false)} className="hover:text-ink">
              Terms
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
