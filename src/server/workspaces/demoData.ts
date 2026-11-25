import { isFeatureEnabled } from '@/src/server/permissions/featureSwitches';

// Whether a workspace shows the sample data in src/mock (Sky, Canopy and
// Ground). Off for every new company; an Owner can turn it on from Feature
// switches for demos.
export function showsDemoData(workspaceId: string): Promise<boolean> {
  return isFeatureEnabled(workspaceId, 'demo_data');
}
