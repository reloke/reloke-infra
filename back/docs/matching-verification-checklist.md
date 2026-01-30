## Matching & Audit Verification Checklist

1. Create two users (A, B) and log in as each.
2. For each user, create Home + Search via existing flows; confirm after save that `Intent.homeId` and `Intent.searchId` are populated.
3. Purchase a pack (or manually credit `totalMatchesRemaining`) for both users; verify `isInFlow` is true only when both links exist.
4. Trigger matching manually or wait for cron; ensure at least one reciprocal match is created when criteria align.
5. Inspect `Match.snapshot` on both rows to confirm populated JSON (algorithmVersion/runId, seeker/target summaries, zones, evaluation).
6. Update Home/Search/Intent fields and confirm `AuditLog` rows capture changedFields; ensure HomeImg changes are not logged.
7. Check logs for matching run: eligible count, missing-link warnings, and per-step debug when `MATCHING_DEBUG=true`.
