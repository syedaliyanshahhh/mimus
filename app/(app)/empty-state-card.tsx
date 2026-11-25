import Link from 'next/link';
import { Card } from '@/components/ui/card';

// What a new company sees where sample data used to be (MULTI_USER_PLAN.md
// A6): what will appear here, and the one step that makes it appear.
export function EmptyStateCard({
  title,
  body,
  action = { href: '/settings/connections', label: 'Connect an account' },
  className = '',
}: {
  title: string;
  body: string;
  action?: { href: string; label: string } | null;
  className?: string;
}) {
  return (
    <Card className={`flex flex-col items-start gap-2 ${className}`}>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="text-sm text-ink-muted">{body}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-2 text-sm font-medium text-accent-strong hover:text-accent"
        >
          {action.label}
        </Link>
      )}
    </Card>
  );
}
