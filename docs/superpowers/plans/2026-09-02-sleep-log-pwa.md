# Sleep Log PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build “眠记”, an installable offline-first PWA for vivo Android phones that records sleep at the moment it happens, preserves trustworthy timestamps, and protects data with local-file backups.

**Architecture:** A React/TypeScript single-page app keeps domain rules independent from the UI. IndexedDB is the authoritative on-device database; a service layer performs state transitions and triggers best-effort external JSON backup after every mutation. A generated service worker caches only the application shell and prompts for updates without interrupting an active sleep segment.

**Tech Stack:** Node.js 24.18.1, npm 11.16.0, React 19.2.8, TypeScript 7.0.2, Vite 8.2.2, `idb` 8.0.3, `vite-plugin-pwa` 1.3.0, Vitest 4.1.11, Testing Library 16.3.3, Playwright 1.62.1.

## Global Constraints

- Product code lives only under `sleep-log/`; do not add or modify the existing study files in the repository root.
- The app is Chinese-only in v1 and uses the confirmed action names: “开始睡觉”, “起床”, “还没睡着”, “撤销起床”, and “再睡一段”.
- The app has no AI, account, cloud sync, business backend, alarm, wearable integration, or arbitrary historical timestamp editing.
- Only one sleep segment may be active at a time.
- Completed timestamps are immutable; users may change only sleep type or delete an erroneous historical segment.
- Undoing “起床” is permitted for exactly 60 seconds after the finish action.
- A segment active for more than 20 hours is shown as exceptional; it is never automatically changed.
- Uncertain or invalid segments remain visible but are excluded from default statistics.
- All sleep data remains usable offline; page reload, lock, browser close, and phone restart must not lose an active start timestamp.
- Automatic folder backup is feature-detected. Unsupported or denied access must fall back to manual JSON download and a 30-day reminder.
- Website updates must not force-refresh while a segment is active and must never clear IndexedDB.
- The visual direction is the approved single-button focused home screen: blue-violet night color, warm daylight nap color, bottom navigation for Today, History, and Settings.

---

## File Structure

```text
sleep-log/
├── index.html                         # Vite entry page and mobile viewport metadata
├── package.json                       # Exact dependencies and test/build scripts
├── package-lock.json                  # Reproducible dependency lock
├── tsconfig.json                      # Strict TypeScript and DOM configuration
├── vite.config.ts                     # React, Vitest, and PWA configuration
├── public/
│   ├── icon-192.svg                   # Install icon at compact size
│   └── icon-512.svg                   # Install/maskable icon at large size
├── src/
│   ├── main.tsx                       # Browser bootstrap
│   ├── App.tsx                        # Navigation and top-level state loading
│   ├── styles.css                     # Design tokens, mobile layout, focus and reduced motion
│   ├── domain/
│   │   ├── sleep.ts                   # Sleep entities and pure state transitions
│   │   ├── stats.ts                   # Day grouping and 7/30-day aggregates
│   │   └── sleep.test.ts              # Domain and statistics tests
│   ├── data/
│   │   ├── repository.ts              # Repository interface and IndexedDB implementation
│   │   ├── repository.test.ts         # IndexedDB persistence and transaction tests
│   │   ├── backup.ts                  # JSON schema, merge, conflict and CSV logic
│   │   ├── backup.test.ts             # Backup round-trip and conflict tests
│   │   ├── file-backup.ts             # Folder picker, automatic write, download fallback
│   │   └── file-backup.test.ts        # Capability and permission failure tests
│   ├── services/
│   │   ├── sleep-service.ts           # Use cases, grouping, undo deadline, backup trigger
│   │   └── sleep-service.test.ts       # Service workflow tests
│   ├── components/
│   │   ├── TodayPage.tsx              # Start/type chooser, active state, finish and undo
│   │   ├── HistoryPage.tsx            # Daily history, details, type change and delete
│   │   ├── SettingsPage.tsx           # Backup folder, restore, CSV and version
│   │   ├── UpdateNotice.tsx            # Safe service-worker update prompt
│   │   └── components.test.tsx         # User-facing component tests
│   ├── pwa/
│   │   └── register.ts                # Prompt-style service-worker registration
│   └── types/
│       └── file-system-access.d.ts     # Minimal Android Chromium file API declarations
├── tests/
│   ├── app.spec.ts                    # Mobile workflow and persistence E2E
│   ├── backup.spec.ts                 # Download/restore E2E
│   └── fixtures.ts                    # Deterministic time and browser setup
└── playwright.config.ts               # Pixel 7-sized Chromium test project and web server
```

---

### Task 1: Project Bootstrap and Pure Sleep Domain

**Files:**
- Create: `sleep-log/package.json`
- Create: `sleep-log/tsconfig.json`
- Create: `sleep-log/vite.config.ts`
- Create: `sleep-log/index.html`
- Create: `sleep-log/src/main.tsx`
- Create: `sleep-log/src/domain/sleep.ts`
- Test: `sleep-log/src/domain/sleep.test.ts`

**Interfaces:**
- Produces: `SleepSegment`, `SleepKind`, `SleepStatus`, `createSegment()`, `resetStart()`, `finishSegment()`, `undoFinish()`, `markUncertain()`, and `durationMs()`.

- [ ] **Step 1: Create the deterministic project configuration**

```json
{
  "name": "mianji-sleep-log",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "check": "npm run test && npm run build && npm run test:e2e"
  },
  "dependencies": {
    "idb": "8.0.3",
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@playwright/test": "1.62.1",
    "@testing-library/jest-dom": "7.0.1",
    "@testing-library/react": "16.3.3",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.5",
    "@vitejs/plugin-react": "6.1.1",
    "fake-indexeddb": "6.2.5",
    "jsdom": "30.0.1",
    "typescript": "7.0.2",
    "vite": "8.2.2",
    "vite-plugin-pwa": "1.3.0",
    "vitest": "4.1.11"
  }
}
```

Use strict compiler options with `target: "ES2022"`, `moduleResolution: "Bundler"`, `jsx: "react-jsx"`, `strict: true`, and DOM/WebWorker libraries. Configure Vitest for `jsdom`, `restoreMocks: true`, and include `src/**/*.test.{ts,tsx}`. Set the HTML language to `zh-CN` and include `viewport-fit=cover`.

Create a minimal entry so the first build is real and runnable:

```tsx
import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')!).render(<main><h1>眠记</h1></main>);
```

- [ ] **Step 2: Install dependencies and create the failing domain tests**

Run: `cd sleep-log && npm install`

Create tests with fixed ISO timestamps:

```ts
import { describe, expect, it } from 'vitest';
import {
  createSegment, durationMs, finishSegment, markUncertain,
  resetStart, undoFinish,
} from './sleep';

describe('sleep state transitions', () => {
  it('records the clicked time and resets it only while active', () => {
    const initial = createSegment({
      id: 'seg-1', kind: 'night', groupId: 'night-1',
      now: '2026-09-02T14:46:00.000Z', timezone: 'Asia/Shanghai',
    });
    const reset = resetStart(initial, '2026-09-02T15:08:00.000Z', 'Asia/Shanghai');
    expect(reset.startAt).toBe('2026-09-02T15:08:00.000Z');
    expect(() => resetStart(finishSegment(reset, '2026-09-02T22:08:00.000Z', 'Asia/Shanghai'), '2026-09-02T15:10:00.000Z', 'Asia/Shanghai')).toThrow('completed timestamps are immutable');
  });

  it('allows undo for 60 seconds and rejects it afterwards', () => {
    const active = createSegment({ id: 'seg-1', kind: 'night', groupId: 'night-1', now: '2026-09-02T15:00:00.000Z', timezone: 'Asia/Shanghai' });
    const done = finishSegment(active, '2026-09-02T22:00:00.000Z', 'Asia/Shanghai');
    expect(undoFinish(done, '2026-09-02T22:00:59.000Z').status).toBe('active');
    expect(() => undoFinish(done, '2026-09-02T22:01:01.000Z')).toThrow('undo window expired');
  });

  it('keeps uncertain data visible but calculates its raw duration', () => {
    const active = createSegment({ id: 'seg-2', kind: 'nap', groupId: null, now: '2026-09-02T05:00:00.000Z', timezone: 'Asia/Shanghai' });
    const uncertain = markUncertain(finishSegment(active, '2026-09-02T06:00:00.000Z', 'Asia/Shanghai'), 'forgot-to-stop');
    expect(uncertain.status).toBe('uncertain');
    expect(durationMs(uncertain)).toBe(3_600_000);
  });
});
```

- [ ] **Step 3: Run the domain test and verify the intended failure**

Run: `cd sleep-log && npm test -- src/domain/sleep.test.ts`

Expected: FAIL because `./sleep` does not exist.

- [ ] **Step 4: Implement immutable domain transitions**

```ts
export type SleepKind = 'night' | 'nap';
export type SleepStatus = 'active' | 'completed' | 'uncertain' | 'invalid';

export interface SleepSegment {
  id: string;
  kind: SleepKind;
  groupId: string | null;
  startAt: string;
  startTimezone: string;
  endAt: string | null;
  endTimezone: string | null;
  status: SleepStatus;
  uncertainReason: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  schemaVersion: 1;
}

export function createSegment(input: { id: string; kind: SleepKind; groupId: string | null; now: string; timezone: string }): SleepSegment {
  return { id: input.id, kind: input.kind, groupId: input.groupId, startAt: input.now, startTimezone: input.timezone, endAt: null, endTimezone: null, status: 'active', uncertainReason: null, createdAt: input.now, updatedAt: input.now, finishedAt: null, schemaVersion: 1 };
}

export function resetStart(segment: SleepSegment, now: string, timezone: string): SleepSegment {
  if (segment.status !== 'active') throw new Error('completed timestamps are immutable');
  return { ...segment, startAt: now, startTimezone: timezone, updatedAt: now };
}

export function finishSegment(segment: SleepSegment, now: string, timezone: string): SleepSegment {
  if (segment.status !== 'active') throw new Error('segment is not active');
  const status: SleepStatus = Date.parse(now) < Date.parse(segment.startAt) ? 'invalid' : 'completed';
  return { ...segment, endAt: now, endTimezone: timezone, status, finishedAt: now, updatedAt: now };
}

export function undoFinish(segment: SleepSegment, now: string): SleepSegment {
  if (!segment.finishedAt || segment.status !== 'completed') throw new Error('segment cannot be undone');
  if (Date.parse(now) - Date.parse(segment.finishedAt) > 60_000) throw new Error('undo window expired');
  return { ...segment, endAt: null, endTimezone: null, status: 'active', finishedAt: null, updatedAt: now };
}

export function markUncertain(segment: SleepSegment, reason: string): SleepSegment {
  if (!segment.endAt) throw new Error('active segment cannot be marked uncertain');
  return { ...segment, status: 'uncertain', uncertainReason: reason, updatedAt: segment.endAt };
}

export function durationMs(segment: SleepSegment): number | null {
  return segment.endAt ? Math.max(0, Date.parse(segment.endAt) - Date.parse(segment.startAt)) : null;
}
```

- [ ] **Step 5: Run the focused tests and build type check**

Run: `cd sleep-log && npm test -- src/domain/sleep.test.ts && npm run build`

Expected: domain tests PASS; build completes with no TypeScript errors.

- [ ] **Step 6: Commit the domain foundation**

```powershell
git add -- sleep-log/package.json sleep-log/package-lock.json sleep-log/tsconfig.json sleep-log/vite.config.ts sleep-log/index.html sleep-log/src/main.tsx sleep-log/src/domain
git commit -m "feat: add sleep record domain"
```

---

### Task 2: IndexedDB Repository and Durable Active State

**Files:**
- Create: `sleep-log/src/data/repository.ts`
- Test: `sleep-log/src/data/repository.test.ts`

**Interfaces:**
- Consumes: `SleepSegment` from `src/domain/sleep.ts`.
- Produces: `SleepRepository` with `get()`, `list()`, `getActive()`, `save()`, `remove()`, and atomic `replaceAll()`; `IndexedDbSleepRepository` implementation.

- [ ] **Step 1: Write repository tests using an isolated fake IndexedDB**

```ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSegment } from '../domain/sleep';
import { deleteSleepDatabase, IndexedDbSleepRepository } from './repository';

describe('IndexedDbSleepRepository', () => {
  beforeEach(deleteSleepDatabase);
  afterEach(deleteSleepDatabase);

  it('persists an active segment across repository instances', async () => {
    const first = new IndexedDbSleepRepository();
    const segment = createSegment({ id: 'seg-1', kind: 'night', groupId: 'night-1', now: '2026-09-02T15:00:00.000Z', timezone: 'Asia/Shanghai' });
    await first.save(segment);
    const reopened = new IndexedDbSleepRepository();
    expect((await reopened.getActive())?.id).toBe('seg-1');
  });

  it('replaces all records atomically', async () => {
    const repo = new IndexedDbSleepRepository();
    const one = createSegment({ id: 'one', kind: 'nap', groupId: null, now: '2026-09-02T05:00:00.000Z', timezone: 'Asia/Shanghai' });
    const two = createSegment({ id: 'two', kind: 'night', groupId: 'night-2', now: '2026-09-02T15:00:00.000Z', timezone: 'Asia/Shanghai' });
    await repo.save(one);
    await repo.replaceAll([two]);
    expect((await repo.list()).map((item) => item.id)).toEqual(['two']);
  });
});
```

- [ ] **Step 2: Run the repository tests and verify failure**

Run: `cd sleep-log && npm test -- src/data/repository.test.ts`

Expected: FAIL because `repository.ts` does not exist.

- [ ] **Step 3: Implement the repository with one transaction per mutation**

```ts
import { DBSchema, deleteDB, IDBPDatabase, openDB } from 'idb';
import type { SleepSegment } from '../domain/sleep';

interface SleepDb extends DBSchema {
  segments: {
    key: string;
    value: SleepSegment;
    indexes: { 'by-status': SleepSegment['status']; 'by-start': string };
  };
}

export interface SleepRepository {
  get(id: string): Promise<SleepSegment | undefined>;
  list(): Promise<SleepSegment[]>;
  getActive(): Promise<SleepSegment | undefined>;
  save(segment: SleepSegment): Promise<void>;
  remove(id: string): Promise<void>;
  replaceAll(segments: SleepSegment[]): Promise<void>;
}

const DB_NAME = 'mianji-sleep-log';

async function connect(): Promise<IDBPDatabase<SleepDb>> {
  return openDB<SleepDb>(DB_NAME, 1, {
    upgrade(db) {
      const store = db.createObjectStore('segments', { keyPath: 'id' });
      store.createIndex('by-status', 'status');
      store.createIndex('by-start', 'startAt');
    },
  });
}

export class IndexedDbSleepRepository implements SleepRepository {
  async get(id: string) { return (await connect()).get('segments', id); }
  async list() { return (await connect()).getAllFromIndex('segments', 'by-start'); }
  async getActive() { return (await connect()).getFromIndex('segments', 'by-status', 'active'); }
  async save(segment: SleepSegment) { await (await connect()).put('segments', segment); }
  async remove(id: string) { await (await connect()).delete('segments', id); }
  async replaceAll(segments: SleepSegment[]) {
    const db = await connect();
    const tx = db.transaction('segments', 'readwrite');
    await tx.store.clear();
    for (const segment of segments) await tx.store.put(segment);
    await tx.done;
  }
}

export async function deleteSleepDatabase() { await deleteDB(DB_NAME); }
```

- [ ] **Step 4: Run repository and domain tests**

Run: `cd sleep-log && npm test -- src/domain/sleep.test.ts src/data/repository.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit durable storage**

```powershell
git add -- sleep-log/src/data/repository.ts sleep-log/src/data/repository.test.ts
git commit -m "feat: persist sleep records in indexeddb"
```

---

### Task 3: Use-Case Service, Night Grouping, and Statistics

**Files:**
- Create: `sleep-log/src/services/sleep-service.ts`
- Create: `sleep-log/src/domain/stats.ts`
- Modify: `sleep-log/src/domain/sleep.test.ts`
- Test: `sleep-log/src/services/sleep-service.test.ts`

**Interfaces:**
- Consumes: `SleepRepository`, domain transitions, a `BackupTrigger`, and injected `Clock`/ID functions.
- Produces: `SleepService` methods `getActive()`, `start()`, `resetActiveStart()`, `cancelActive()`, `wake()`, `undoWake()`, `continueNight()`, `changeKind()`, `deleteSegment()`, and `resolveOverlong()`; `buildStats()`.

- [ ] **Step 1: Write service tests for the exact user workflows**

```ts
it('prevents a second active segment and links continued night sleep', async () => {
  await service.start('night');
  await expect(service.start('nap')).rejects.toThrow('已有正在记录的睡眠');
  const first = await service.wake();
  clock.set('2026-09-03T00:40:00.000Z');
  const second = await service.continueNight(first.id);
  expect(second.groupId).toBe(first.groupId);
});

it('backs up every successful mutation', async () => {
  await service.start('nap');
  await service.resetActiveStart();
  await service.wake();
  expect(backupTrigger.run).toHaveBeenCalledTimes(3);
});

it('marks a 20-hour active record uncertain only after user confirmation', async () => {
  await service.start('night');
  clock.advanceHours(21);
  const active = await service.getActive();
  expect(service.isOverlong(active!)).toBe(true);
  const ended = await service.resolveOverlong('finish-uncertain');
  expect(ended?.status).toBe('uncertain');
});
```

- [ ] **Step 2: Run the service tests and verify failure**

Run: `cd sleep-log && npm test -- src/services/sleep-service.test.ts`

Expected: FAIL because `SleepService` is undefined.

- [ ] **Step 3: Implement the service boundary**

```ts
export interface Clock { nowIso(): string; timezone(): string; }
export interface BackupTrigger { run(): Promise<void>; } // Contract: records warning status instead of rejecting.

export class SleepService {
  constructor(private repo: SleepRepository, private clock: Clock, private newId: () => string, private backup: BackupTrigger) {}

  async start(kind: SleepKind, groupId: string | null = null) {
    if (await this.repo.getActive()) throw new Error('已有正在记录的睡眠');
    const now = this.clock.nowIso();
    const segment = createSegment({ id: this.newId(), kind, groupId: kind === 'night' ? groupId ?? this.newId() : null, now, timezone: this.clock.timezone() });
    await this.repo.save(segment); await this.backup.run(); return segment;
  }

  async resetActiveStart() {
    const active = await this.requireActive();
    const value = resetStart(active, this.clock.nowIso(), this.clock.timezone());
    await this.repo.save(value); await this.backup.run(); return value;
  }

  async cancelActive() { const active = await this.requireActive(); await this.repo.remove(active.id); await this.backup.run(); }

  async wake() {
    const active = await this.requireActive();
    const value = finishSegment(active, this.clock.nowIso(), this.clock.timezone());
    await this.repo.save(value); await this.backup.run(); return value;
  }

  async undoWake(id: string) {
    const value = await this.requireById(id);
    const undone = undoFinish(value, this.clock.nowIso());
    await this.repo.save(undone); await this.backup.run(); return undone;
  }

  async continueNight(previousId: string) {
    const previous = await this.requireById(previousId);
    if (previous.kind !== 'night' || !previous.groupId) throw new Error('只能继续夜间睡眠');
    return this.start('night', previous.groupId);
  }

  async getActive() { return this.repo.getActive(); }

  async changeKind(id: string, kind: SleepKind) {
    const current = await this.requireById(id);
    if (current.status === 'active') throw new Error('记录中不能修改睡眠类型');
    const all = await this.repo.list();
    const sameWakeDateNight = all.find((item) => item.id !== id && item.kind === 'night' && item.endAt && current.endAt && displayDate(item.endAt, item.endTimezone ?? item.startTimezone) === displayDate(current.endAt, current.endTimezone ?? current.startTimezone));
    const changed = { ...current, kind, groupId: kind === 'nap' ? null : sameWakeDateNight?.groupId ?? this.newId(), updatedAt: this.clock.nowIso() };
    await this.repo.save(changed); await this.backup.run(); return changed;
  }

  async deleteSegment(id: string) {
    const current = await this.requireById(id);
    if (current.status === 'active') throw new Error('请使用取消本次记录');
    await this.repo.remove(id); await this.backup.run();
  }

  async resolveOverlong(action: 'finish-uncertain' | 'delete' | 'continue') {
    const active = await this.requireActive();
    if (!this.isOverlong(active)) throw new Error('记录尚未超过20小时');
    if (action === 'continue') return active;
    if (action === 'delete') { await this.repo.remove(active.id); await this.backup.run(); return null; }
    const ended = markUncertain(finishSegment(active, this.clock.nowIso(), this.clock.timezone()), 'over-20-hours');
    await this.repo.save(ended); await this.backup.run(); return ended;
  }

  isOverlong(segment: SleepSegment) { return Date.parse(this.clock.nowIso()) - Date.parse(segment.startAt) > 72_000_000; }

  private async requireActive() { const value = await this.repo.getActive(); if (!value) throw new Error('没有正在记录的睡眠'); return value; }
  private async requireById(id: string) { const value = await this.repo.get(id); if (!value) throw new Error('睡眠记录不存在'); return value; }
}
```

Define `displayDate(iso, timezone)` once in `domain/stats.ts` and import it here. Every `BackupTrigger.run()` implementation must catch external-file errors, save `needs-permission` or `write-failed` status, and resolve; a backup failure must never roll back or disguise a successful local sleep mutation.

- [ ] **Step 4: Add deterministic statistics tests and implementation**

```ts
export interface SleepStats {
  days: Array<{ date: string; nightMs: number; napMs: number; totalMs: number }>;
  averageNightMs: number;
  averageNapMs: number;
  averageTotalMs: number;
  excludedCount: number;
}

export function buildStats(segments: SleepSegment[], rangeDays: 7 | 30, today: string, timezone: string): SleepStats;
```

Implement date keys and aggregation as follows. Averages use only days that contain the corresponding trusted type; missing days are not treated as zero sleep.

```ts
it('sums night segments, keeps naps separate, and excludes uncertain data', () => {
  const segments = [
    completed('n1', 'night', 'g1', '2026-09-02T15:00:00.000Z', '2026-09-02T18:00:00.000Z'),
    completed('n2', 'night', 'g1', '2026-09-02T18:30:00.000Z', '2026-09-02T22:30:00.000Z'),
    completed('p1', 'nap', null, '2026-09-03T05:00:00.000Z', '2026-09-03T05:30:00.000Z'),
    { ...completed('bad', 'night', 'g2', '2026-09-01T15:00:00.000Z', '2026-09-01T22:00:00.000Z'), status: 'uncertain' as const },
  ];
  const result = buildStats(segments, 7, '2026-09-03', 'Asia/Shanghai');
  expect(result.days.find((day) => day.date === '2026-09-03')).toEqual({ date: '2026-09-03', nightMs: 25_200_000, napMs: 1_800_000, totalMs: 27_000_000 });
  expect(result.excludedCount).toBe(1);
  expect(result.averageNightMs).toBe(25_200_000);
});
```

```ts
export function displayDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function buildStats(segments: SleepSegment[], rangeDays: 7 | 30, today: string, timezone: string): SleepStats {
  const anchor = new Date(`${today}T12:00:00.000Z`);
  const allowed = new Set(Array.from({ length: rangeDays }, (_, index) => {
    const date = new Date(anchor); date.setUTCDate(date.getUTCDate() - index); return date.toISOString().slice(0, 10);
  }));
  const totals = new Map<string, { date: string; nightMs: number; napMs: number; totalMs: number }>();
  let excludedCount = 0;
  for (const segment of segments) {
    if (!segment.endAt) continue;
    const date = displayDate(segment.endAt, timezone);
    if (!allowed.has(date)) continue;
    if (segment.status !== 'completed') { excludedCount += 1; continue; }
    const ms = durationMs(segment) ?? 0;
    const day = totals.get(date) ?? { date, nightMs: 0, napMs: 0, totalMs: 0 };
    if (segment.kind === 'night') day.nightMs += ms; else day.napMs += ms;
    day.totalMs += ms; totals.set(date, day);
  }
  const days = [...totals.values()].sort((a, b) => a.date.localeCompare(b.date));
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return { days, averageNightMs: average(days.map((day) => day.nightMs).filter(Boolean)), averageNapMs: average(days.map((day) => day.napMs).filter(Boolean)), averageTotalMs: average(days.map((day) => day.totalMs).filter(Boolean)), excludedCount };
}
```

The test-local `completed()` helper creates a schema-version-1 completed `SleepSegment` from its six arguments. Add a second assertion that two nap rows retain separate history entries even though their daily `napMs` is summed.

- [ ] **Step 5: Run all focused tests**

Run: `cd sleep-log && npm test -- src/domain src/services`

Expected: all domain, grouping, overlong, and statistics tests PASS.

- [ ] **Step 6: Commit service and statistics**

```powershell
git add -- sleep-log/src/services sleep-log/src/domain
git commit -m "feat: add sleep workflows and statistics"
```

---

### Task 4: Versioned Backup, Merge, CSV, and External File Adapter

**Files:**
- Create: `sleep-log/src/data/backup.ts`
- Create: `sleep-log/src/data/backup.test.ts`
- Create: `sleep-log/src/data/file-backup.ts`
- Create: `sleep-log/src/data/file-backup.test.ts`
- Create: `sleep-log/src/types/file-system-access.d.ts`

**Interfaces:**
- Consumes: all segments from `SleepRepository`.
- Produces: `createBackup()`, `parseBackup()`, `mergeBackup()`, `toCsv()`, `BrowserFileBackup`, `BackupSettingsRepository`, `AutoBackupTrigger`, and `requestPersistentStorage()`.

- [ ] **Step 1: Write backup schema and merge tests**

```ts
it('round-trips a versioned backup', () => {
  const text = createBackup([completedNight]);
  expect(parseBackup(text).segments).toEqual([completedNight]);
});

it('deduplicates exact records but stops on same-id conflicts', () => {
  expect(mergeBackup([completedNight], [completedNight])).toEqual({ merged: [completedNight], conflicts: [] });
  const duplicateWithNewId = { ...completedNight, id: 'imported-copy' };
  expect(mergeBackup([completedNight], [duplicateWithNewId]).merged).toEqual([completedNight]);
  const changed = { ...completedNight, kind: 'nap' as const, groupId: null };
  expect(mergeBackup([completedNight], [changed]).conflicts).toEqual([{ current: completedNight, incoming: changed }]);
});

it('exports one escaped CSV row per segment', () => {
  expect(toCsv([completedNight])).toContain('夜间睡眠');
  expect(toCsv([completedNight]).trimEnd().split('\r\n')).toHaveLength(2);
});
```

- [ ] **Step 2: Run backup tests and verify failure**

Run: `cd sleep-log && npm test -- src/data/backup.test.ts`

Expected: FAIL because backup functions do not exist.

- [ ] **Step 3: Implement strict backup parsing and conflict results**

```ts
export interface SleepBackup { app: '眠记'; version: 1; exportedAt: string; segments: SleepSegment[]; }
export interface MergeConflict { current: SleepSegment; incoming: SleepSegment; }

export function createBackup(segments: SleepSegment[], exportedAt = new Date().toISOString()): string {
  return JSON.stringify({ app: '眠记', version: 1, exportedAt, segments } satisfies SleepBackup, null, 2);
}

export function parseBackup(text: string): SleepBackup {
  const value: unknown = JSON.parse(text);
  if (!isSleepBackup(value)) throw new Error('备份文件格式不正确');
  return value;
}

export function mergeBackup(current: SleepSegment[], incoming: SleepSegment[]) {
  const map = new Map(current.map((segment) => [segment.id, segment]));
  const fingerprint = (segment: SleepSegment) => JSON.stringify({ kind: segment.kind, groupId: segment.groupId, startAt: segment.startAt, endAt: segment.endAt, status: segment.status, uncertainReason: segment.uncertainReason });
  const seen = new Set(current.map(fingerprint));
  const conflicts: MergeConflict[] = [];
  for (const segment of incoming) {
    const existing = map.get(segment.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(segment)) conflicts.push({ current: existing, incoming: segment });
    else if (!existing && !seen.has(fingerprint(segment))) { map.set(segment.id, segment); seen.add(fingerprint(segment)); }
  }
  return { merged: [...map.values()].sort((a, b) => a.startAt.localeCompare(b.startAt)), conflicts };
}
```

`isSleepBackup()` must validate every required field and enum value. `toCsv()` must emit UTF-8 BOM, Chinese headers, CRLF rows, ISO timestamps, duration minutes, group ID, and status; quote fields and double embedded quotes.

- [ ] **Step 4: Write file adapter failure-first tests**

```ts
it('reports unsupported when no directory picker exists', () => {
  expect(new BrowserFileBackup(window).capability()).toBe('manual-only');
});

it('does not lose local data when external writing fails', async () => {
  const failingHandle = {
    getFileHandle: async () => ({
      createWritable: async () => ({ write: async () => { throw new Error('disk full'); }, close: async () => undefined, abort: async () => undefined }),
    }),
  } as unknown as FileSystemDirectoryHandle;
  const adapter = new BrowserFileBackup(window);
  await expect(adapter.writeTo(failingHandle, '{"version":1}')).rejects.toThrow('自动备份写入失败');
});
```

- [ ] **Step 5: Implement capability detection, file write, persistence request, and fallback download**

```ts
export type BackupCapability = 'folder-auto' | 'manual-only';
export class BrowserFileBackup {
  constructor(private browser: Window) {}
  capability(): BackupCapability { return 'showDirectoryPicker' in this.browser ? 'folder-auto' : 'manual-only'; }
  async chooseFolder() { return this.browser.showDirectoryPicker({ mode: 'readwrite' }); }
  async writeTo(handle: FileSystemDirectoryHandle, text: string) {
    const file = await handle.getFileHandle('眠记-自动备份.json', { create: true });
    const writable = await file.createWritable();
    try { await writable.write(text); await writable.close(); }
    catch (error) { await writable.abort(); throw new Error('自动备份写入失败', { cause: error }); }
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  return navigator.storage?.persist ? navigator.storage.persist() : false;
}

export function downloadBackup(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
```

Persist the granted directory handle and backup status in a separate IndexedDB `settings` store. If permission is not `granted`, do not prompt outside a user gesture; mark status `needs-permission`. Calculate the manual reminder from `lastSuccessfulBackupAt` and show it after 30 days. The trigger catches every external error so a successful local sleep mutation is never reported as failed:

```ts
export interface BackupStatus { state: 'ready' | 'needs-permission' | 'write-failed' | 'manual-only'; lastSuccessfulBackupAt: string | null; message: string | null; }
export interface BackupSettingsRepository {
  getDirectory(): Promise<FileSystemDirectoryHandle | null>;
  setDirectory(handle: FileSystemDirectoryHandle): Promise<void>;
  getStatus(): Promise<BackupStatus>;
  setStatus(status: BackupStatus): Promise<void>;
}

export class AutoBackupTrigger implements BackupTrigger {
  constructor(private sleep: SleepRepository, private settings: BackupSettingsRepository, private files: BrowserFileBackup, private now: () => string) {}
  async run(): Promise<void> {
    const handle = await this.settings.getDirectory();
    if (!handle) {
      await this.settings.setStatus({ state: this.files.capability() === 'folder-auto' ? 'needs-permission' : 'manual-only', lastSuccessfulBackupAt: (await this.settings.getStatus()).lastSuccessfulBackupAt, message: null });
      return;
    }
    try {
      await this.files.writeTo(handle, createBackup(await this.sleep.list(), this.now()));
      await this.settings.setStatus({ state: 'ready', lastSuccessfulBackupAt: this.now(), message: null });
    } catch (error) {
      await this.settings.setStatus({ state: 'write-failed', lastSuccessfulBackupAt: (await this.settings.getStatus()).lastSuccessfulBackupAt, message: error instanceof Error ? error.message : '自动备份写入失败' });
    }
  }
}
```

- [ ] **Step 6: Run data tests and commit**

Run: `cd sleep-log && npm test -- src/data`

Expected: repository, backup, CSV, and file adapter tests PASS.

```powershell
git add -- sleep-log/src/data sleep-log/src/types
git commit -m "feat: add resilient sleep data backups"
```

---

### Task 5: Focused Today Page and Recording Interaction

**Files:**
- Modify: `sleep-log/src/main.tsx`
- Create: `sleep-log/src/App.tsx`
- Create: `sleep-log/src/components/TodayPage.tsx`
- Create: `sleep-log/src/components/components.test.tsx`
- Create: `sleep-log/src/styles.css`

**Interfaces:**
- Consumes: `SleepService`, repository data, and backup status.
- Produces: accessible controls for start/type selection, active state, reset, cancel, finish, 60-second undo, continue-night, and overlong resolution.

- [ ] **Step 1: Write user-facing component tests before markup**

```tsx
it('starts night sleep from the single-button chooser', async () => {
  render(<TodayPage model={idleModel} actions={actions} />);
  await user.click(screen.getByRole('button', { name: '开始睡觉' }));
  await user.click(screen.getByRole('button', { name: '夜间睡眠' }));
  expect(actions.start).toHaveBeenCalledWith('night');
});

it('resets the active start only after confirmation', async () => {
  render(<TodayPage model={activeModel} actions={actions} />);
  await user.click(screen.getByRole('button', { name: '还没睡着' }));
  expect(actions.resetStart).toHaveBeenCalledOnce();
});

it('never offers historical time editing after finish', () => {
  render(<TodayPage model={completedModel} actions={actions} />);
  expect(screen.queryByRole('button', { name: /修改.*时间/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '撤销起床' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the component tests and verify failure**

Run: `cd sleep-log && npm test -- src/components/components.test.tsx`

Expected: FAIL because `TodayPage` does not exist.

- [ ] **Step 3: Implement explicit UI states instead of one conditional-heavy component**

```ts
export type TodayModel =
  | { state: 'idle'; lastNightMs: number | null; backupWarning: string | null }
  | { state: 'active'; segment: SleepSegment; elapsedMs: number; overlong: boolean; backupWarning: string | null }
  | { state: 'finished'; segment: SleepSegment; groupSegments: SleepSegment[]; undoUntil: string; backupWarning: string | null };
```

`TodayPage` must render one named subview per state: `IdleView`, `ActiveView`, `FinishedView`, and `OverlongDialog`. The idle primary button opens a bottom sheet with exactly two type buttons. The active primary button says “起床”; “还没睡着” is visible but secondary; cancellation requires a confirmation dialog. Finished view shows segment/group totals, “撤销起床” only before `undoUntil`, and “再睡一段” only for night records.

- [ ] **Step 4: Apply the approved visual tokens and accessibility floor**

```css
:root {
  --ink: #263141; --muted: #758299; --surface: #f5f7fb; --card: #ffffff;
  --night: #354c89; --night-soft: #e7ecf9; --nap: #e3aa58; --nap-soft: #fff0d2;
  --danger: #a94747; --line: #e1e6ef; --focus: #2257c7;
  font-family: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
}
body { margin: 0; min-width: 320px; min-height: 100dvh; color: var(--ink); background: var(--surface); }
button { min-height: 44px; font: inherit; }
button:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
```

Use safe-area padding with `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`. The circular primary control must remain reachable at 320×568 CSS pixels and labels must not depend on color alone.

- [ ] **Step 5: Run components, domain, and build checks**

Run: `cd sleep-log && npm test && npm run build`

Expected: all unit/component tests PASS and production build succeeds.

- [ ] **Step 6: Commit the daily recording interface**

```powershell
git add -- sleep-log/src/main.tsx sleep-log/src/App.tsx sleep-log/src/components sleep-log/src/styles.css
git commit -m "feat: add focused sleep recording interface"
```

---

### Task 6: History, Statistics, Type Correction, and Settings

**Files:**
- Create: `sleep-log/src/components/HistoryPage.tsx`
- Create: `sleep-log/src/components/SettingsPage.tsx`
- Modify: `sleep-log/src/App.tsx`
- Modify: `sleep-log/src/components/components.test.tsx`

**Interfaces:**
- Consumes: `buildStats()`, repository list, service `changeKind()`/`deleteSegment()`, backup parse/merge/CSV, and `BrowserFileBackup`.
- Produces: Today/History/Settings bottom navigation and all non-recording workflows.

- [ ] **Step 1: Add failing component tests for the trustworthy-history boundary**

```tsx
it('shows excluded records without putting them in averages', () => {
  render(<HistoryPage segments={[completedNight, uncertainNight]} today="2026-09-03" timezone="Asia/Shanghai" actions={actions} />);
  expect(screen.getByText('1 条不准确记录未计入统计')).toBeInTheDocument();
  expect(screen.getByText('时间可能不准确')).toBeInTheDocument();
});

it('allows type correction and deletion but no timestamp edit', async () => {
  render(<HistoryPage segments={[completedNight]} today="2026-09-03" timezone="Asia/Shanghai" actions={actions} />);
  expect(screen.queryByLabelText('开始时间')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '改为午睡' }));
  expect(actions.changeKind).toHaveBeenCalledWith(completedNight.id, 'nap');
});

it('previews a restore before applying it', async () => {
  render(<SettingsPage model={settingsModel} actions={actions} />);
  await user.upload(screen.getByLabelText('选择备份文件'), validBackupFile);
  expect(await screen.findByText('1 条记录，2026年9月2日至2026年9月3日')).toBeInTheDocument();
  expect(actions.restore).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests and verify the missing-page failures**

Run: `cd sleep-log && npm test -- src/components/components.test.tsx`

Expected: FAIL for missing `HistoryPage` and `SettingsPage`.

- [ ] **Step 3: Implement History with 7/30-day toggle and daily details**

History defaults to 7 days and renders a semantic bar chart where every bar also has a text duration. Daily cards show night, nap, total, group segments, and trustworthy status. Type correction is a two-choice sheet; deletion requires a dialog naming the date and duration. No date/time input may be rendered anywhere in completed-record history.

```tsx
<nav aria-label="主要页面">
  <button aria-current={tab === 'today' ? 'page' : undefined}>今天</button>
  <button aria-current={tab === 'history' ? 'page' : undefined}>历史</button>
  <button aria-current={tab === 'settings' ? 'page' : undefined}>设置</button>
</nav>
```

- [ ] **Step 4: Implement Settings backup status and safe restore decisions**

Settings shows capability (`自动备份可用` or `需要手动备份`), last success timestamp, stale warning, choose-folder button, JSON download, restore picker, CSV download, and app version. Restore flow is parse → preview → merge → conflict choice → one `replaceAll()` transaction → automatic backup. Never write if parse fails or unresolved conflicts remain.

```ts
export type RestoreDecision =
  | { kind: 'cancel' }
  | { kind: 'merge'; conflicts: Record<string, 'keep-current' | 'use-backup'> };
```

- [ ] **Step 5: Run all tests and build**

Run: `cd sleep-log && npm test && npm run build`

Expected: all tests PASS; no TypeScript or bundle errors.

- [ ] **Step 6: Commit history and data management**

```powershell
git add -- sleep-log/src/App.tsx sleep-log/src/components
git commit -m "feat: add sleep history and data management"
```

---

### Task 7: Installable Offline PWA and Safe Updates

**Files:**
- Modify: `sleep-log/vite.config.ts`
- Create: `sleep-log/public/icon-192.svg`
- Create: `sleep-log/public/icon-512.svg`
- Create: `sleep-log/src/pwa/register.ts`
- Create: `sleep-log/src/components/UpdateNotice.tsx`
- Modify: `sleep-log/src/App.tsx`

**Interfaces:**
- Consumes: whether `SleepService.getActive()` returns a segment.
- Produces: install manifest, offline shell, `needRefresh`, `applyUpdate()`, and deferred-update UI.

- [ ] **Step 1: Add PWA configuration and a failing update-policy test**

```tsx
it('defers a waiting update while sleep is active', () => {
  render(<UpdateNotice needRefresh activeSegment={activeNight} applyUpdate={applyUpdate} />);
  expect(screen.getByText('记录结束后可更新')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '立即更新' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Configure prompt-style service worker registration**

```ts
VitePWA({
  registerType: 'prompt',
  includeAssets: ['icon-192.svg', 'icon-512.svg'],
  manifest: {
    name: '眠记', short_name: '眠记', lang: 'zh-CN',
    start_url: '/', display: 'standalone', background_color: '#f5f7fb', theme_color: '#354c89',
    icons: [
      { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
      { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
    ],
  },
  workbox: { navigateFallback: '/index.html', cleanupOutdatedCaches: true },
})
```

Create both SVG files from this original mark; set the root `width`/`height` to `192` for `icon-192.svg` and `512` for `icon-512.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#354c89"/>
  <circle cx="246" cy="238" r="112" fill="#eef2fb"/>
  <circle cx="300" cy="190" r="112" fill="#354c89"/>
  <circle cx="350" cy="360" r="24" fill="#e3aa58"/>
</svg>
```

- [ ] **Step 3: Implement the registration and deferred update component**

```ts
import { registerSW } from 'virtual:pwa-register';
export function registerAppServiceWorker(onNeedRefresh: () => void) {
  return registerSW({ immediate: true, onNeedRefresh, onRegisteredSW: (_url, registration) => window.setInterval(() => registration?.update(), 60 * 60 * 1000) });
}
```

`UpdateNotice` must show “立即更新” only when no segment is active. With an active segment, show a passive status and retain the waiting worker until the segment finishes.

- [ ] **Step 4: Build and inspect the generated manifest/service worker**

Run: `cd sleep-log && npm run build && npx vite preview --host 127.0.0.1 --port 4173`

Expected: `dist/manifest.webmanifest` and generated service-worker assets exist; the preview reports `http://127.0.0.1:4173`.

- [ ] **Step 5: Verify offline reload manually in Chromium DevTools or Playwright context**

Load once online, switch the context offline, reload `/`, and verify the Today page renders and IndexedDB records remain readable.

- [ ] **Step 6: Commit PWA installation and updates**

```powershell
git add -- sleep-log/vite.config.ts sleep-log/public sleep-log/src/pwa sleep-log/src/components/UpdateNotice.tsx sleep-log/src/App.tsx
git commit -m "feat: make sleep log installable and offline"
```

---

### Task 8: Mobile End-to-End Verification and Deployment-Ready Handoff

**Files:**
- Create: `sleep-log/playwright.config.ts`
- Create: `sleep-log/tests/fixtures.ts`
- Create: `sleep-log/tests/app.spec.ts`
- Create: `sleep-log/tests/backup.spec.ts`
- Create: `sleep-log/README.md`

**Interfaces:**
- Consumes: complete built PWA.
- Produces: repeatable mobile-browser verification and a provider-neutral `dist/` ready for HTTPS static hosting.

- [ ] **Step 1: Configure deterministic Pixel-sized Chromium tests**

```ts
export default defineConfig({
  testDir: './tests',
  use: { ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:4173', locale: 'zh-CN', timezoneId: 'Asia/Shanghai' },
  webServer: { command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173', port: 4173, reuseExistingServer: false },
});
```

- [ ] **Step 2: Write E2E tests for the complete recording path**

```ts
test('night sleep survives reload and supports real-time correction', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始睡觉' }).click();
  await page.getByRole('button', { name: '夜间睡眠' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '起床' })).toBeVisible();
  await page.getByRole('button', { name: '还没睡着' }).click();
  await page.getByRole('button', { name: '起床' }).click();
  await expect(page.getByRole('button', { name: '撤销起床' })).toBeVisible();
  await expect(page.getByLabel('修改开始时间')).toHaveCount(0);
});
```

Create exactly these additional named tests: two naps on one date render two rows and their summed daily total; “再睡一段” renders two segments in one night card; an active record seeded 21 hours earlier shows the three actions “按现在结束并标记不准确”, “删除误记录”, and “继续记录”; uncertain data is visible but excluded from the displayed average; type correction never renders start/end inputs; deletion survives cancel and occurs only after confirm; the 7/30-day controls expose the selected range with `aria-pressed`; a 320×568 viewport satisfies `document.documentElement.scrollWidth <= window.innerWidth`; keyboard Tab reaches the primary action with a visible outline; reduced-motion emulation removes meaningful transition duration. Seed application storage only for the 21-hour and statistics scenarios.

- [ ] **Step 3: Write backup E2E with download and restored browser context**

```ts
test('recovers after site data is cleared', async ({ browser }, testInfo) => {
  const first = await browser.newContext();
  const page = await first.newPage();
  await page.goto('http://127.0.0.1:4173');
  await page.getByRole('button', { name: '开始睡觉' }).click();
  await page.getByRole('button', { name: '午睡' }).click();
  await page.getByRole('button', { name: '起床' }).click();
  const download = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '导出完整备份' }).click()]);
  const backupPath = testInfo.outputPath('眠记-备份.json');
  await download[0].saveAs(backupPath);
  await first.close();
  const restored = await browser.newContext();
  const restoredPage = await restored.newPage();
  await restoredPage.goto('http://127.0.0.1:4173');
  await restoredPage.getByLabel('选择备份文件').setInputFiles(backupPath);
  await restoredPage.getByRole('button', { name: '确认恢复' }).click();
  await expect(restoredPage.getByText('午睡')).toBeVisible();
  await restored.close();
});
```

- [ ] **Step 4: Run the complete verification suite**

Run: `cd sleep-log && npm run check`

Expected: unit/component tests PASS, production build PASS, all mobile E2E tests PASS.

- [ ] **Step 5: Inspect screenshots at 320×568 and Pixel 7 sizes**

Confirm no clipped controls, no horizontal overflow, 44px minimum touch targets, safe-area bottom navigation, readable type chooser, visible backup warning, and no timestamp edit affordance in history. Correct any failure and rerun `npm run check`.

- [ ] **Step 6: Write the user README and build the final static bundle**

README must contain exact sections: local start, test commands, production build, vivo “添加到桌面” steps, offline behavior, local-data warning, automatic-folder-backup compatibility, manual backup fallback, restore procedure, and the statement that `dist/` contains no user sleep data.

Run: `cd sleep-log && npm run build`

Expected: `sleep-log/dist/` is ready to upload unchanged to any HTTPS static host.

- [ ] **Step 7: Commit verified application and documentation**

```powershell
git add -- sleep-log/playwright.config.ts sleep-log/tests sleep-log/README.md sleep-log/src sleep-log/public sleep-log/package.json sleep-log/package-lock.json sleep-log/tsconfig.json sleep-log/vite.config.ts sleep-log/index.html
git commit -m "test: verify sleep log PWA end to end"
```

- [ ] **Step 8: Stop before external publication and request the hosting destination**

Report the passing `npm run check` output and the absolute `dist/` path. Ask the user to choose or provide an HTTPS static hosting destination; do not create an account, repository, or public site without that explicit choice.
