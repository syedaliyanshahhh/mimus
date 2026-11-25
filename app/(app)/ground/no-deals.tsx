import { EmptyStateCard } from '../empty-state-card';

export function NoDeals() {
  return (
    <EmptyStateCard
      title="No deals yet"
      body="A deal's timeline, people and files appear here once your pipeline is connected."
    />
  );
}
