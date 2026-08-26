/**
 * Snapshot-only unrestricted policy service for the isolated fs-search runnable.
 * @module examples/acp-agent/tests/fixtures/danger-sandbox-policy
 */
import { resolve } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyRequest } from '@deepseek-ai/dsh-sandbox-policy'

/** Snapshot-only policy service that keeps the fs-search transcript free of unrelated policy guidance. */
export default class DangerSandboxPolicy extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sandboxPolicy')
  }

  /**
   * Resolve one unrestricted policy while preserving the calling workspace identity.
   * @param request - optional calling session.
   * @returns the unrestricted execution policy for this snapshot.
   */
  resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy {
    return {
      mode: 'danger-full-access',
      workspaceRoot: resolve(request.session?.header.cwd ?? process.cwd()),
      ...request.session === undefined ? {} : { sessionId: request.session.id },
    }
  }
}
