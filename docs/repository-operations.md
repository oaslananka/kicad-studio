# Repository Operations

## Dual-owner mirror model

- `oaslananka/kicad-studio` is the canonical public repository.
- `oaslananka-lab/kicad-studio` is the CI/CD runner mirror.
- The human pushes only to the canonical repo.
- The org mirror periodically (every 15 mins) pulls from canonical and replays branches/tags.
- **Zero GitHub Actions** are consumed on the personal `oaslananka` account.

## Daily operations

### Local sync

```bash
bash scripts/sync-remotes.sh
```

### Secret verification

```bash
task doppler:check
```

### Manual Sync Trigger

If you need immediate CI feedback without waiting for the 15-minute cron:

```bash
# Trigger sync from org side
gh workflow run "Sync from canonical" --repo oaslananka-lab/kicad-studio
```

## Repository hygiene

A cleanup script is available to identify and prune old branches:

```bash
bash scripts/repo-cleanup.sh           # dry-run
bash scripts/repo-cleanup.sh --apply   # execute deletions
```

## Defensive Actions Disable

To ensure zero minutes are consumed on the personal repo, it is recommended to disable Actions at the API level:

```bash
gh api -X PUT /repos/oaslananka/kicad-studio/actions/permissions -f enabled=false
```

## Auto-delete head branches

It is recommended to enable "Automatically delete head branches" in GitHub settings for the canonical repo:

```bash
gh api -X PATCH /repos/oaslananka/kicad-studio -f delete_branch_on_merge=true
```
