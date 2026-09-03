# 眠记 APP 迁移与备份界面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将眠记从依赖浏览器存储的 PWA 调整为诚实的手动备份过渡版，并建立 Android APP、本地 SQLite 数据库和后续桌面小组件的基础。

**Architecture:** 网页版不再承诺“永久存储”：仅在浏览器实际支持授权文件夹时显示自动备份，其他浏览器只显示 JSON 导出与恢复。APP 使用 Capacitor 容器和原生 SQLite 保存睡眠记录；同一业务服务继续消费 `SleepRepository` 接口，从而保持现有记录、统计与备份逻辑可复用。桌面小组件通过原生共享状态层读取当前睡眠状态，作为 APP 数据层稳定后的独立交付。

**Tech Stack:** React 19、TypeScript、Vite、Vitest、Playwright、Capacitor Android/iOS、`@capacitor-community/sqlite`、Android Kotlin。

## Global Constraints

- 网页版不得继续显示“永久”“锁定”或任何浏览器无法保证的存储承诺。
- 未做过备份必须显示“尚未导出备份”，不得显示“超过 30 天”。
- 仅 `BrowserFileBackup.capability() === 'folder-auto'` 时展示自动备份设置。
- APP 默认无账号、无密码；删除、清空、恢复覆盖仍保留二次确认。
- Android 本地数据使用应用内部 SQLite；APP 更新不得清空或重建既有数据。
- APP 卸载、清除 APP 数据、设备损坏仍可能丢失数据，保留 JSON 导出和恢复。
- iOS 工程与 Capacitor 配置在本任务创建；iOS 归档和 App Store 签名须在 macOS/Xcode 环境验证。
- 每项行为变化先写失败测试，再写最小实现。

---

## File Structure

- `sleep-log/src/data/file-backup.ts`：备份状态结构、旧状态兼容和浏览器备份能力判断。
- `sleep-log/src/data/backup.ts`：手动导出提醒的纯函数。
- `sleep-log/src/components/SettingsPage.tsx`：网页备份过渡界面；不再使用持久化请求按钮。
- `sleep-log/src/components/components.test.tsx`：设置页文字、条件渲染与导出提醒回归测试。
- `sleep-log/src/App.tsx`：移除网页启动时的持久化请求，记录手动导出时间。
- `sleep-log/src/data/native-sqlite-repository.ts`：Capacitor 原生 SQLite 的 `SleepRepository` 实现。
- `sleep-log/src/data/repository-factory.ts`：按运行平台选择 IndexedDB 或原生 SQLite。
- `sleep-log/capacitor.config.ts`：Capacitor 应用标识和静态资源配置。
- `sleep-log/android/`：Capacitor 生成的 Android 容器及 SQLite 插件原生配置。
- `sleep-log/ios/`：Capacitor 生成的 iOS 容器；仅生成工程，不在 Windows 上归档。
- `sleep-log/src/native/widget-state.ts`：将活动睡眠摘要镜像给原生桌面小组件的接口。

---

### Task 1: 建立准确的备份状态模型

**Files:**
- Modify: `sleep-log/src/data/file-backup.ts`
- Modify: `sleep-log/src/data/backup.ts`
- Modify: `sleep-log/src/data/file-backup.test.ts`
- Modify: `sleep-log/src/data/backup.test.ts`

**Interfaces:**
- Produces `BackupStatus` with optional `lastAutomaticBackupAt`, `lastManualExportAt`, `legacyBackupAt`, and `message`.
- Produces `shouldRemindManualBackup(lastManualExportAt: string | null, nowMs: number, days?: number): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
it('does not call an unexported backup older than 30 days', () => {
  expect(shouldRemindManualBackup(null, Date.UTC(2026, 8, 3))).toBe(false);
});

it('reminds only when a successful manual export is older than 30 days', () => {
  expect(shouldRemindManualBackup('2026-07-01T00:00:00.000Z', Date.UTC(2026, 8, 3))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/data/backup.test.ts`

Expected: failure because the current function treats `null` as overdue.

- [ ] **Step 3: Write the minimal implementation**

```ts
export interface BackupStatus {
  state: 'ready' | 'needs-permission' | 'write-failed' | 'manual-only';
  lastAutomaticBackupAt?: string | null;
  lastManualExportAt?: string | null;
  legacyBackupAt?: string | null;
  message: string | null;
}

export function shouldRemindManualBackup(lastManualExportAt: string | null, nowMs: number, days = 30): boolean {
  if (!lastManualExportAt) return false;
  const lastMs = Date.parse(lastManualExportAt);
  return !Number.isFinite(lastMs) || nowMs - lastMs >= days * 24 * 60 * 60 * 1000;
}
```

`getStatus()` maps existing `lastSuccessfulBackupAt` to `legacyBackupAt`, preserving the date without falsely naming it automatic or manual.

- [ ] **Step 4: Run focused data tests**

Run: `npm test -- src/data/backup.test.ts src/data/file-backup.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add sleep-log/src/data/file-backup.ts sleep-log/src/data/backup.ts sleep-log/src/data/file-backup.test.ts sleep-log/src/data/backup.test.ts
git commit -m "fix: distinguish manual backup from auto backup status"
```

### Task 2: Replace misleading PWA backup and storage UI

**Files:**
- Modify: `sleep-log/src/App.tsx`
- Modify: `sleep-log/src/components/SettingsPage.tsx`
- Modify: `sleep-log/src/components/components.test.tsx`
- Modify: `sleep-log/src/styles.css`

**Interfaces:**
- Consumes `BackupStatus.lastAutomaticBackupAt` and `BackupStatus.lastManualExportAt`.
- Produces settings UI sections `自动备份` only when usable and `导出备份` for all browsers.

- [ ] **Step 1: Write failing component tests**

```tsx
it('shows an unexported state instead of an overdue warning in manual-only browsers', () => {
  render(<SettingsPage model={{ ...settingsModel, capability: 'manual-only', status: { state: 'manual-only', message: null } }} timezone="Asia/Shanghai" actions={makeSettingsActions()} />);
  expect(screen.getByText('尚未导出备份')).toBeInTheDocument();
  expect(screen.queryByText(/超过 30 天/)).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '手机自动备份' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/components.test.tsx -t "unexported state"`

Expected: failure because the old UI always renders automatic backup and the overdue warning.

- [ ] **Step 3: Write the minimal implementation**

- Remove the PWA startup call to `navigator.storage.persist()` and remove the “本地持久化存储” section and request button.
- Render `自动备份` only when capability is `folder-auto`; explain that it writes after a record changes and does not run while the browser is closed.
- Render a JSON export card in every browser with exact states: `尚未导出备份`, `最近导出：YYYY年M月D日`, and the 30-day reminder only for an old manual export.
- After `downloadBackup()`, store `lastManualExportAt: clock.nowIso()`.

- [ ] **Step 4: Run focused UI and browser tests**

Run: `npm test -- src/components/components.test.tsx; npm run test:e2e`

Expected: all component and mobile browser workflows pass.

- [ ] **Step 5: Commit**

```powershell
git add sleep-log/src/App.tsx sleep-log/src/components/SettingsPage.tsx sleep-log/src/components/components.test.tsx sleep-log/src/styles.css
git commit -m "fix: make PWA backup guidance accurate"
```

### Task 3: Create the Capacitor application shell

**Files:**
- Create: `sleep-log/capacitor.config.ts`
- Modify: `sleep-log/package.json`
- Modify: `sleep-log/package-lock.json`
- Create: `sleep-log/android/` via `npx cap add android`
- Create: `sleep-log/ios/` via `npx cap add ios`

**Interfaces:**
- Produces application id `com.mianji.sleep`, app name `眠记`, and `webDir: 'dist'`.
- Produces `npm run cap:sync`, `npm run android:open`, and `npm run ios:open`.

- [ ] **Step 1: Write failing config test**

```ts
import config from '../../capacitor.config';

it('uses the stable mobile id and built web directory', () => {
  expect(config.appId).toBe('com.mianji.sleep');
  expect(config.webDir).toBe('dist');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/native/capacitor-config.test.ts`

Expected: failure resolving the missing Capacitor config.

- [ ] **Step 3: Install and configure Capacitor**

```powershell
npm install @capacitor/core @capacitor/android @capacitor/ios
npm install -D @capacitor/cli
npx cap init 眠记 com.mianji.sleep --web-dir dist
npx cap add android
npx cap add ios
```

Create `capacitor.config.ts`:

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mianji.sleep',
  appName: '眠记',
  webDir: 'dist',
};

export default config;
```

- [ ] **Step 4: Verify native sync**

Run: `npm test -- src/native/capacitor-config.test.ts; npm run cap:sync`

Expected: config test passes and Capacitor copies `dist` into native projects.

- [ ] **Step 5: Commit**

```powershell
git add sleep-log/capacitor.config.ts sleep-log/package.json sleep-log/package-lock.json sleep-log/android sleep-log/ios sleep-log/src/native/capacitor-config.test.ts
git commit -m "feat: add Capacitor Android and iOS shells"
```

### Task 4: Add native SQLite storage and explicit migration

**Files:**
- Create: `sleep-log/src/data/native-sqlite-repository.ts`
- Create: `sleep-log/src/data/repository-factory.ts`
- Modify: `sleep-log/src/App.tsx`
- Modify: `sleep-log/src/data/repository.ts`
- Create: `sleep-log/src/data/native-sqlite-repository.test.ts`
- Modify: `sleep-log/package.json`, `sleep-log/package-lock.json`, `sleep-log/android/`, and `sleep-log/ios/`.

**Interfaces:**
- Produces `createSleepRepository(): SleepRepository`.
- Produces `NativeSqliteSleepRepository` with the existing repository operations.

- [ ] **Step 1: Write failing repository contract test**

```ts
it('persists an active record and prevents a second active record', async () => {
  const repo = new NativeSqliteSleepRepository(fakeSqliteConnection());
  await repo.initialize();
  expect(await repo.createActiveIfNone(activeNight)).toEqual(activeNight);
  expect(await repo.createActiveIfNone(activeNap)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/data/native-sqlite-repository.test.ts`

Expected: failure resolving the missing repository.

- [ ] **Step 3: Implement a narrow SQL adapter**

```ts
export interface SqliteAdapter {
  execute(sql: string, values?: unknown[]): Promise<void>;
  query<T>(sql: string, values?: unknown[]): Promise<T[]>;
  transaction<T>(operation: () => Promise<T>): Promise<T>;
}

export class NativeSqliteSleepRepository implements SleepRepository {
  constructor(private readonly db: SqliteAdapter) {}
  async initialize(): Promise<void> { /* create sleep_segments table and indexes */ }
  async createActiveIfNone(segment: SleepSegment): Promise<SleepSegment | null> { /* one transaction */ }
}
```

Use `@capacitor-community/sqlite` in native builds. `createSleepRepository()` selects native SQLite only on a Capacitor native platform and retains the existing IndexedDB repository for web.

- [ ] **Step 4: Add explicit one-time JSON import**

The APP offers “导入网页备份” on first launch, calls existing `parseBackup()`, inserts all valid segments in one SQLite transaction, and marks `native_migration_complete`. It must not silently read or delete browser IndexedDB data.

- [ ] **Step 5: Verify**

Run: `npm test -- src/data/native-sqlite-repository.test.ts src/services/sleep-service.test.ts; npm run cap:sync`

Expected: repository contract passes and native projects sync.

- [ ] **Step 6: Commit**

```powershell
git add sleep-log/src/data/native-sqlite-repository.ts sleep-log/src/data/repository-factory.ts sleep-log/src/data/repository.ts sleep-log/src/data/native-sqlite-repository.test.ts sleep-log/src/App.tsx sleep-log/package.json sleep-log/package-lock.json sleep-log/android sleep-log/ios
git commit -m "feat: persist app records in native SQLite"
```

### Task 5: Establish the Android widget state foundation

**Files:**
- Create: `sleep-log/src/native/widget-state.ts`
- Create: `sleep-log/src/native/widget-state.test.ts`
- Modify: `sleep-log/src/App.tsx`
- Create: `sleep-log/android/app/src/main/java/com/mianji/sleep/SleepWidgetState.kt`
- Create: `sleep-log/android/app/src/main/res/xml/sleep_widget_info.xml`
- Create: `sleep-log/android/app/src/main/res/layout/sleep_widget.xml`

**Interfaces:**
- Produces `publishWidgetState(snapshot: WidgetSleepState): Promise<void>`.
- Produces `WidgetSleepState = { state: 'idle' | 'active' | 'finished'; kind?: 'night' | 'nap'; startedAt?: string; elapsedMs?: number }`.

- [ ] **Step 1: Write failing state-publishing test**

```ts
it('publishes an active sleep summary for a native widget', async () => {
  const publish = vi.fn().mockResolvedValue(undefined);
  await publishWidgetState({ state: 'active', kind: 'night', startedAt: '2026-09-03T14:00:00.000Z', elapsedMs: 0 }, publish);
  expect(publish).toHaveBeenCalledWith(expect.objectContaining({ state: 'active', kind: 'night' }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/native/widget-state.test.ts`

Expected: failure resolving the missing module.

- [ ] **Step 3: Implement shared state and a read-only widget**

Mirror the summarized state to Android SharedPreferences after every record mutation. The widget shows: `开始记录` when idle, kind plus duration when active, and latest duration when finished. Each tap opens the APP. Do not add direct start/wake actions until the receiver is proven to use the same native SQLite transaction rules.

- [ ] **Step 4: Build debug APK and commit**

Run: `cd android; .\\gradlew.bat assembleDebug`

Expected: `android/app/build/outputs/apk/debug/app-debug.apk` exists.

```powershell
git add sleep-log/src/native/widget-state.ts sleep-log/src/native/widget-state.test.ts sleep-log/src/App.tsx sleep-log/android
git commit -m "feat: add Android widget state foundation"
```

### Task 6: Final verification and update documentation

**Files:**
- Modify: `sleep-log/README.md`
- Create: `sleep-log/docs/ANDROID_INSTALL_AND_UPDATE.md`
- Create: `sleep-log/docs/PRIVACY_AND_BACKUP.md`

- [ ] **Step 1: Document data guarantees**

State that APP updates preserve SQLite data; APP uninstall, clear-data, or device loss require a JSON backup to recover; PWA is a temporary/manual-export experience.

- [ ] **Step 2: Run full verification**

Run: `npm run check; npm run cap:sync; cd android; .\\gradlew.bat assembleDebug`

Expected: Vitest, Vite build, Playwright, Capacitor sync, and Android debug assembly succeed.

- [ ] **Step 3: Verify artifacts and commit**

Run: `Get-Item android\\app\\build\\outputs\\apk\\debug\\app-debug.apk, docs\\ANDROID_INSTALL_AND_UPDATE.md, docs\\PRIVACY_AND_BACKUP.md`

```powershell
git add sleep-log/README.md sleep-log/docs
git commit -m "docs: explain mobile backup and update guarantees"
```

## Plan Self-Review

- **Spec coverage:** Task 1 resolves false “30 天” alerts; Task 2 removes misleading browser persistence UI; Tasks 3–4 create the cross-platform app and native SQLite; Task 5 establishes the homescreen-widget path without unsafe direct writes; Task 6 defines update and data-retention behavior.
- **Placeholder scan:** No TBD/TODO items. Direct widget mutations are deliberately excluded until the shared SQLite transaction contract is verified.
- **Type consistency:** `BackupStatus` is consumed by Task 2 exactly as introduced in Task 1; `SleepRepository` remains the shared service boundary; widget state is a separate `WidgetSleepState` summary and does not expose raw database access.

