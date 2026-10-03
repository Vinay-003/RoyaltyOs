import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeByResource, authorizeWorkspace } from '../../apps/api/auth.ts';
import { testConfig } from '../helpers.ts';

function request() {
  return { headers: { authorization: 'Bearer fake.jwt.token' } } as any;
}

test('resource authorization derives workspace from server record and blocks cross-workspace IDOR', async () => {
  const calls: string[] = [];
  const ctx: any = {
    config: testConfig(),
    supabase: {
      verifyUser: async () => ({ id: 'user-a', email: 'a@example.com' }),
      select: async (table: string) => {
        assert.equal(table, 'settlements');
        return [{ id: 'settlement-b', workspace_id: 'workspace-b' }];
      },
    },
    repo: {
      sessionRevokedBefore: async () => null,
      requireRole: async (_userId: string, workspaceId: string) => {
        calls.push(workspaceId);
        const error = new Error('Forbidden: workspace role is not authorized') as Error & { status?: number };
        error.status = 403;
        throw error;
      },
    },
  };
  await assert.rejects(
    authorizeByResource(ctx, request(), 'settlements', 'settlement-b', ['OWNER']),
    /Forbidden/,
  );
  assert.deepEqual(calls, ['workspace-b']);
});

test('sensitive workspace authorization requires recent step-up after role authorization', async () => {
  const order: string[] = [];
  const ctx: any = {
    config: testConfig({ STEP_UP_TTL_SECONDS: '900' }),
    supabase: { verifyUser: async () => ({ id: 'owner', email: 'owner@example.com' }) },
    repo: {
      sessionRevokedBefore: async () => null,
      requireRole: async () => { order.push('role'); return { role: 'OWNER' }; },
      requireRecentStepUp: async (_id: string, ttl: number) => { order.push(`step:${ttl}`); },
    },
  };
  await authorizeWorkspace(ctx, request(), 'workspace-a', ['OWNER'], true);
  assert.deepEqual(order, ['role', 'step:900']);
});
