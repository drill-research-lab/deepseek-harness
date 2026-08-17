# Agent Note: fork CI activation

Status: implemented

## Problem

The fork cannot use the owning organization's issue-management credentials or enterprise runner labels. Running those workflows unchanged makes issue jobs fail while required CI jobs remain queued on infrastructure the fork does not control. Successful required jobs are also difficult to assess from the pull request because their results remain distributed across the Actions run.

## Decision

Issue lifecycle and policy jobs run only when `github.repository_owner == 'deepseek-harness'`. Forks do not attempt to mint the owning organization's GitHub App token or enforce policy against its issue repository.

The required Linux workers and independent native Windows job retain the owning organization's hosted and self-hosted failover choices while adding standard GitHub-hosted runners as the fork fallback. The [CI failover runbook](2026-07-26-ci-failover-runbook.md) remains the owner of the two repository-variable switches and self-hosted pool operation. Master-only self-hosted standby jobs carry the same owner guard so a fork push cannot queue on those pools.

The `all checks passed` job upserts one pull-request comment marked by `<!-- dsh-ci-summary -->`. The comment renders only the required jobs' GitHub-controlled result values and links the Actions run. Posting is best effort under `pull-requests: write`; Dependabot or another read-only token may reject it without changing the verdict because the step uses `continue-on-error: true`. The following step remains the sole branch-protection decision and fails whenever a required dependency is not successful.

The fork's issue and pull-request templates use English operational copy. Documentation pairing does not own `.github/` contribution templates.

## Alternatives considered

**Keep the owning organization's runner labels on forks.** Rejected because a fork cannot provision or select those enterprise pools, so required jobs do not reach execution.

**Run issue-management workflows and tolerate missing credentials.** Rejected because credential failure is not issue-policy evidence and makes every fork pull request red for an unavailable integration.

**Use only the Actions checks list.** Rejected because the marker-owned comment gives reviewers one stable summary that updates in place, while its best-effort failure mode keeps branch protection independent of comment permissions.

## Consequences

Fork pull requests execute required checks on standard GitHub-hosted capacity without changing the owning organization's enterprise and failover paths. Owner-specific issue automation is intentionally absent on forks. The summary comment adds a write-scoped but non-blocking bookkeeping step whose structure and permissions are pinned by `scripts/ci-workflow.spec.ts`; branch protection continues to depend only on the final required-job verdict.
