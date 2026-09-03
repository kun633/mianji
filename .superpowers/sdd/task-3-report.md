# Task 3 Report: Use-Case Service, Night Grouping, and Statistics

## Status

Implemented the task-3 service boundary, night grouping, over-20-hour resolution, and 7/30-day statistics. No UI, backup file format, later-task code, or root study files were changed. No dependency installation or network access was used.

## Scope and files

- Created `sleep-log/src/services/sleep-service.ts`.
- Created `sleep-log/src/services/sleep-service.test.ts`.
- Created `sleep-log/src/domain/stats.ts`.
- Modified `sleep-log/src/domain/sleep.test.ts`.
- The test-only `completed()` constructor remains in `sleep.test.ts`; it is not exported by production code.
- Existing untracked `sleep-log/node_modules/`, `sleep-log/dist/`, and `sleep-log/tsconfig.tsbuildinfo` were deliberately excluded from staging and commit.

## Implementation

- `SleepService` exposes `getActive`, `start`, `resetActiveStart`, `cancelActive`, `wake`, `undoWake`, `continueNight`, `changeKind`, `deleteSegment`, `resolveOverlong`, and `isOverlong`.
- Night starts receive a generated group ID. `continueNight` reuses the prior night segment's group ID. Changing a completed segment to night reuses a night group from the same wake date where available.
- A second active segment is rejected. Active records cannot be changed by `changeKind` or `deleteSegment`; their dedicated flows remain reset/cancel/wake.
- Records older than 20 hours remain active until `resolveOverlong` is called. The three actions preserve, delete, or finish as `uncertain` with reason `over-20-hours`.
- Every successful local mutation invokes the same service-level backup helper. Backup failures are recorded with `console.warn` and absorbed, so the completed local mutation result is still returned to the caller.
- `displayDate` produces timezone-specific calendar dates. `buildStats` archives by end/wake date in the requested timezone, includes only the requested 7/30-day window, excludes non-completed records, separates night and nap totals, and averages only days where each trusted type exists.

## TDD evidence

### Baseline

Command: `npm test`

Result before task changes: PASS — 2 files, 7 tests.

### RED

Command: `npm test -- src/services/sleep-service.test.ts`

Result: FAIL — import resolution failed because `src/services/sleep-service.ts` did not exist. This was the expected missing-feature failure.

Command: `npm test -- src/domain/sleep.test.ts`

Result: FAIL — import resolution failed because `src/domain/stats.ts` did not exist. This was the expected missing-feature failure.

### GREEN

Command: `npm test -- src/services/sleep-service.test.ts src/domain/sleep.test.ts`

Result: PASS — 2 files, 15 tests.

### Task 3 repair RED

Command: `npm test -- src/services/sleep-service.test.ts`

Result: FAIL — 3 tests failed as expected: a second active segment was not rejected by `undoWake`, and rejected backups from mutation paths were propagated to callers.

### Task 3 repair GREEN

Command: `npm test -- src/services/sleep-service.test.ts`

Result: PASS — 1 file, 9 tests.

### Backup rejection mutation coverage

Command: `npm test -- src/services/sleep-service.test.ts`

Result: PASS — 1 file, 13 tests. The four newly added tests passed immediately because the existing service-level `triggerBackup()` already catches rejected backups. No production change was needed.

### Focused verification

Command: `npm test -- src/domain src/services`

Result: PASS — 2 files, 15 tests.

Command: `npm run build`

Result: PASS — TypeScript project build and Vite production build completed.

### Final verification

Command: `npm test`

Result: PASS — 3 files, 17 tests, 0 failures.

Command: `npm run build`

Result: PASS — `tsc -b` and Vite production build completed successfully.

Command: `git diff --check` and `git diff --cached --check`

Result: PASS — no whitespace errors. Git emitted only the repository's LF-to-CRLF checkout warnings.

## Test coverage added

- Second-active rejection and continued-night group reuse.
- `undoWake` rejects a different active segment and preserves both records.
- Rejected backups are absorbed after local start/reset/wake/undo/cancel mutations.
- Rejected backups are absorbed after completed-record `changeKind` and `deleteSegment`, and overlong `finish-uncertain` and `delete`; each test verifies the resulting local repository state.
- Backup invocation after successful start/reset/wake and deletion flows.
- 21-hour detection and confirmed uncertain finish.
- Active cancellation, wake undo, active edit/delete guards, completed deletion, and overlong continue/delete choices.
- Same-wake-date night grouping after kind change.
- Night segment summation, separate nap totals, uncertain exclusion, timezone wake-date attribution, missing-day average behavior, and two distinct nap source rows summed into one daily nap total.

## Self-review

- Compared all public methods and exact error strings against the task brief.
- Confirmed the 20-hour predicate uses strict `> 72_000_000`, as specified.
- Confirmed statistics use `endAt` and the supplied statistics timezone, not start date.
- Confirmed missing days are absent rather than inserted as zeroes; per-type zeroes are filtered before averages.
- Confirmed `completed()` exists only in test code.
- Confirmed all mutation paths use the service-level backup failure handling, including start/reset/cancel/wake/undo/change/delete/overlong resolution.
- Confirmed no unrelated tracked file changes are included.

## Commit

Original commit: `ebbbac3 feat: add sleep workflows and statistics`

Task 3 repair commit: `5db4295 fix: harden sleep service mutations`

The commit contains exactly these four task files:

- `sleep-log/src/domain/sleep.test.ts`
- `sleep-log/src/domain/stats.ts`
- `sleep-log/src/services/sleep-service.test.ts`
- `sleep-log/src/services/sleep-service.ts`
