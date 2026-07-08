# MCP Push Policy

This document defines how automated agents (including MCP tools such as `create_or_update_file` and `push_files`) must interact with this repository.

## Protected branch: `main`

`main` is the production branch. Direct pushes are discouraged; prefer feature branches and pull requests when possible.

### GitHub branch protection (required)

Enable branch protection on `main` in GitHub repository settings:

1. Go to **Settings → Branches → Branch protection rules**.
2. Add a rule for `main`.
3. Enable **Require a pull request before merging** (recommended).
4. Enable **Require status checks to pass before merging** and select the CI workflow.
5. Optionally enable **Require branches to be up to date before merging**.

Branch protection cannot be configured from this repository alone; it must be enabled in GitHub settings by a repository admin.

## Mandatory verification before any push to `main`

Before pushing **any** change to `main` (whether via MCP, local git, or CI), the agent or developer **must** run:

```bash
bash scripts/verify-page-svelte.sh
```

This script verifies that `src/routes/+page.svelte` is complete (not a stub), contains required incidents-page symbols, and passes `npm run check`.

If verification fails, **do not push**. Fix the issue locally and re-run the script until it passes.

## MCP workflow

1. Make changes locally or via MCP on a feature branch when branch protection requires PRs.
2. Run `bash scripts/verify-page-svelte.sh`.
3. Only after a successful run, push to `main` (or open a PR from a feature branch).
4. Never push placeholder, stub, or truncated `+page.svelte` content.

## Why this matters

Commit history has shown that stub or truncated `+page.svelte` content can reach `main` with misleading commit messages. CI catches regressions **after** a bad commit lands. Pre-push verification and branch protection reduce that risk.
