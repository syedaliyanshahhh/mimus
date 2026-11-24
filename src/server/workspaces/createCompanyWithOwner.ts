import { createServiceClient } from '@/src/db/service';

// A thin pass-through to create_company_with_owner() (migration 0026), which
// validates the names and creates the company, its first workspace and the
// Owner membership together. `userId` must come from the caller's verified
// session. Errors carry the function's user-facing message.
export async function createCompanyWithOwner(params: {
  userId: string;
  companyName: string;
  workspaceName: string;
}): Promise<string> {
  const { data, error } = await createServiceClient().rpc('create_company_with_owner', {
    p_user_id: params.userId,
    p_company_name: params.companyName,
    p_workspace_name: params.workspaceName,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as string;
}
