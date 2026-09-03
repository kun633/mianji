# Sleep Log Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan as one consolidated task. Follow test-driven development for every bug.

**Goal:** Correct the confirmed post-Gemini data-integrity, recording-flow, statistics, and failure-feedback defects without expanding the product scope.

**Architecture:** Keep IndexedDB authoritative. Put concurrency guarantees in repository transactions, pure grouping and restore preparation in domain/data helpers, and user-facing pending/error states in React. Reuse one canonical night-group wake date for history, statistics, and type correction.

**Tech Stack:** React 19, TypeScript 7, IndexedDB/idb, Vitest, Testing Library, Playwright, Vite PWA.

## Global Constraints

- No AI, account, cloud sync, backend, alarm, wearable integration, or arbitrary historical timestamp editing.
- Exactly one sleep segment may be active, including under rapid repeated clicks and multiple service calls.
- Restore must never silently lose current data, duplicate exact records, or apply unresolved conflicts.
- Uncertain and invalid segments remain visible but are excluded from default totals and averages.
- A multi-segment night belongs to the wake date/timezone of its final segment.
- Every production fix starts with a regression test that fails for the expected reason.
- Do not commit `node_modules`, `dist`, `test-results`, or `tsconfig.tsbuildinfo`.

---

### Task 1: Consolidated Reliability and Correctness Repair

**Files:**
- Modify: `sleep-log/src/data/repository.ts`
- Modify: `sleep-log/src/data/repository.test.ts`
- Modify: `sleep-log/src/data/backup.ts`
- Modify: `sleep-log/src/data/backup.test.ts`
- Modify: `sleep-log/src/domain/stats.ts`
- Modify: `sleep-log/src/domain/sleep.test.ts`
- Modify: `sleep-log/src/services/sleep-service.ts`
- Modify: `sleep-log/src/services/sleep-service.test.ts`
- Modify: `sleep-log/src/App.tsx`
- Modify: `sleep-log/src/components/TodayPage.tsx`
- Modify: `sleep-log/src/components/HistoryPage.tsx`
- Modify: `sleep-log/src/components/SettingsPage.tsx`
- Modify: `sleep-log/src/components/components.test.tsx`
- Modify: `sleep-log/src/styles.css`
- Modify: `sleep-log/tests/app.spec.ts`
- Modify: `sleep-log/tests/backup.spec.ts`

**Interfaces:**
- Add an atomic repository operation that inserts a new active segment only when no active segment exists in the same read/write transaction.
- Add an atomic compare-and-replace restore operation that verifies the current snapshot is unchanged before clearing and replacing records.
- Add pure helpers for canonical night grouping/wake date and resolved backup merge output.
- Preserve existing exported APIs where possible; update test fakes deliberately where a repository contract must expand.

- [ ] **Step 1: Add RED tests for recording and repository concurrency**

Add tests proving two concurrent starts cannot create two active rows. Add a browser/component regression proving a completed nap screen offers `记录新的睡眠`, opens the same two-choice sheet, and can start a fresh night or nap while `再睡一段` remains night-only.

Run the focused repository/service/component tests. Confirm they fail because insertion is not atomic and the finished view has no new-record action.

- [ ] **Step 2: Implement atomic active creation and finished-screen restart**

Perform active-index lookup and insert in one IndexedDB transaction. Have `SleepService.start()` use it and return the existing Chinese error when rejected. Extract/reuse the type chooser in `TodayPage`; add `记录新的睡眠` to finished state and keep `再睡一段` for continuing the same night group. Add pending protection so repeated taps do not submit twice.

- [ ] **Step 3: Add RED tests for safe restore**

Cover all of these cases:

- same-content/different-ID backup restores only one record;
- conflicts begin unresolved and confirmation is disabled until every conflict is explicitly chosen;
- conflict display shows the actual differing values, including same-type/different-time conflicts;
- if repository contents change after preview, confirmation aborts without clearing new data;
- backups containing more than one active segment are rejected;
- manual JSON export updates the manual-backup reminder timestamp.

Run focused backup/repository/component tests and confirm the expected failures.

- [ ] **Step 4: Implement resolved merge and compare-and-replace restore**

Keep `mergeBackup(...).merged` as the restore base, then apply explicit per-ID conflict choices to that base. Do not preselect conflict choices. At confirmation, pass the preview snapshot and replacement to an atomic repository compare-and-replace operation; if different, show `记录已发生变化，请重新预览备份` and write nothing. Reject imports with multiple active segments. Record a successful manual JSON export timestamp without treating CSV as a recoverable backup.

- [ ] **Step 5: Add RED tests for night grouping and invalid data**

Cover a two-segment night whose segments end on opposite sides of midnight; it must appear as one night on the final wake date and contribute one combined daily night total. Cover viewing a record created in another timezone. Cover changing a nap to night when an existing multi-segment night spans midnight. Cover an invalid negative-duration segment: visible with an invalid label, excluded from group/day totals, never subtracting time. Assert each history day displays night, nap, and all-sleep totals.

Run focused stats/service/history tests and confirm failures.

- [ ] **Step 6: Implement canonical grouping and daily summaries**

Create one pure grouping model used by stats and history. Night segments share the final segment's wake date and end timezone; naps use their own end date/timezone. Format stored start/end times using their stored timezones. Aggregate only `completed` segments into default totals; keep `uncertain` and `invalid` visible with explicit labels. Make `changeKind()` compare against each night group's final wake date rather than any member segment.

- [ ] **Step 7: Add RED tests for failure feedback and backup status**

Cover IndexedDB initialization failure, mutation failure, folder-picker cancellation, failed replacement folder write, persistent-storage rejection, and automatic-backup failure. The app must not stay forever on loading, must retain the previous folder on replacement failure, and must show a `role="alert"` message without discarding the current UI. The Today page must show a concise backup warning for `write-failed` or `needs-permission`.

- [ ] **Step 8: Implement one error/pending pathway and visual accessibility fixes**

Centralize App mutation execution so rejected promises become a visible Chinese alert and controls cannot double-submit. Add retry for initial load failure. Validate a new backup folder with a successful write before saving its handle; treat picker `AbortError` as cancellation. Propagate backup status into every Today model. Darken the active control and muted text to meet WCAG AA contrast. Add basic dialog focus entry, Escape handling where cancellation is allowed, and focus restoration without changing the approved layout.

- [ ] **Step 9: Verify the consolidated repair**

Run:

```powershell
cd sleep-log
npm test
npm run build
npm run test:e2e
git diff --check
```

Also run a 320x568 Chromium smoke flow: start nap, finish, start another record, reload active state, export/import, and confirm no console errors.

- [ ] **Step 10: Commit**

```powershell
git add -- sleep-log/src sleep-log/tests
git commit -m "fix: harden sleep recording and restore flows"
```

Write implementation evidence to `.superpowers/sdd/hardening-report.md` with the RED commands/failures, GREEN commands/results, changed files, and commit hash.
