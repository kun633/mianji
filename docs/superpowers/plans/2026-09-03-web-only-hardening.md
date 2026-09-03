# 眠记网页版隔离与可靠性加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让眠记只以网页版/PWA 运行，原生代码保留但不加载，并通过诚实的持久化状态、可靠的外部 JSON 导出和准确的隐私说明降低数据丢失风险。

**Architecture:** 网页入口直接注入 IndexedDB 仓库，彻底断开 Capacitor、SQLite 和小组件模块的依赖图。浏览器存储保护封装为可检测、可申请但不承诺永久的独立 API；下载工具负责完整 DOM 生命周期，设置页只在成功触发导出后记录时间。反馈继续使用现有邮件转发服务，但明确网络边界。

**Tech Stack:** React 19、TypeScript 7、Vite 8、IndexedDB/idb、Vitest、Testing Library、Playwright、vite-plugin-pwa。

## Global Constraints

- 当前只交付网页版/PWA，不构建、发布或验证 APK、IPA 和应用商店版本。
- 保留 `android/`、`ios/`、`capacitor.config.ts`、SQLite 和小组件源码，但网页入口不得引用它们。
- 网页不得使用“永久存储”“绝不丢失”或等价承诺。
- IndexedDB 名称、睡眠数据结构和 JSON 备份格式保持不变。
- 持久化申请必须由用户点击触发，启动时只检查状态。
- 用户主动清除网站数据、卸载浏览器、换机和设备损坏的风险必须明确说明。
- 只有用户主动提交反馈时才发送反馈正文、可选联系方式和提交时间；睡眠记录不得上传。
- 每项行为变化先运行失败测试，再做最小实现。

---

## File Structure

- `sleep-log/src/main.tsx`：纯网页入口，只创建 IndexedDB 仓库。
- `sleep-log/src/App.tsx`：网页状态与操作协调；不调用小组件桥接。
- `sleep-log/src/data/browser-storage.ts`：检查与申请浏览器防自动清理保护。
- `sleep-log/src/data/browser-storage.test.ts`：持久化状态和失败路径测试。
- `sleep-log/src/data/file-backup.ts`：浏览器文件下载及自动文件夹备份。
- `sleep-log/src/data/file-backup.test.ts`：临时下载链接生命周期测试。
- `sleep-log/src/components/SettingsPage.tsx`：存储保护、导出、恢复、反馈与隐私界面。
- `sleep-log/src/components/components.test.tsx`：设置页状态、失败提示和隐私文案测试。
- `sleep-log/tests/backup.spec.ts`：真实浏览器导出状态回归。
- `sleep-log/scripts/check-web-bundle.mjs`：检查生产资源未打包原生标识。
- `sleep-log/package.json`：把产物检查加入完整核验命令。
- `sleep-log/README.md`：网页版数据保护与反馈联网边界。

### Task 1: 隔离网页版与原生运行链路

**Files:**
- Modify: `sleep-log/src/main.tsx`
- Modify: `sleep-log/src/App.tsx`
- Create: `sleep-log/scripts/check-web-bundle.mjs`
- Modify: `sleep-log/package.json`

**Interfaces:**
- Produces: 网页入口 `new IndexedDbSleepRepository()`。
- Produces: `npm run check:web-bundle`，在发现原生标识时以非零状态退出。

- [ ] **Step 1: 创建会失败的生产包检查器**

```js
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const files = readdirSync(dist, { recursive: true })
  .filter((name) => typeof name === 'string' && name.endsWith('.js'));
const text = files.map((name) => readFileSync(join(dist, name), 'utf8')).join('\n');
const forbidden = ['CapacitorSQLite', 'SleepWidgetBridge', 'mianji_sleepSQLite'];
const found = forbidden.filter((token) => text.includes(token));
if (found.length) {
  throw new Error(`网页版包含原生模块：${found.join(', ')}`);
}
console.log('网页版未包含原生模块');
```

在 `package.json` 增加：

```json
"check:web-bundle": "node scripts/check-web-bundle.mjs"
```

- [ ] **Step 2: 运行现有构建和检查器，确认失败**

Run: `npm run build; npm run check:web-bundle`

Expected: 构建成功，检查器因当前资源包含 `CapacitorSQLite` 或 `SleepWidgetBridge` 而失败。

- [ ] **Step 3: 写入最小网页入口**

`main.tsx` 使用以下完整入口逻辑：

```tsx
import { createRoot } from 'react-dom/client';
import App from './App';
import { IndexedDbSleepRepository } from './data/repository';
import './styles.css';

const repository = new IndexedDbSleepRepository();
createRoot(document.getElementById('root')!).render(<App initialRepository={repository} />);
```

从 `App.tsx` 删除 `publishWidgetState` 导入以及监听 `model` 并发布 idle/active/finished 状态的整个 effect。不得删除原生桥接文件。

- [ ] **Step 4: 验证生产资源已隔离**

Run: `npm run build; npm run check:web-bundle`

Expected: 两条命令均成功，输出“网页版未包含原生模块”。

- [ ] **Step 5: 提交**

```powershell
git add sleep-log/src/main.tsx sleep-log/src/App.tsx sleep-log/scripts/check-web-bundle.mjs sleep-log/package.json
git commit -m "fix: isolate native modules from web build"
```

### Task 2: 恢复诚实的浏览器防自动清理保护

**Files:**
- Create: `sleep-log/src/data/browser-storage.ts`
- Create: `sleep-log/src/data/browser-storage.test.ts`
- Modify: `sleep-log/src/App.tsx`
- Modify: `sleep-log/src/components/SettingsPage.tsx`
- Modify: `sleep-log/src/components/components.test.tsx`

**Interfaces:**
- Produces: `StorageProtectionState = 'checking' | 'granted' | 'not-granted' | 'unsupported' | 'unknown'`。
- Produces: `checkStorageProtection(storage?: Pick<StorageManager, 'persisted'>): Promise<StorageProtectionState>`。
- Produces: `requestStorageProtection(storage?: Pick<StorageManager, 'persist'>): Promise<boolean>`。
- `SettingsModel` 增加 `storageProtection: StorageProtectionState`。
- `SettingsActions` 增加 `requestStorageProtection(): Promise<void>`。

- [ ] **Step 1: 写失败的数据层测试**

```ts
it('reports the browser persisted result without claiming permanence', async () => {
  expect(await checkStorageProtection({ persisted: async () => true })).toBe('granted');
  expect(await checkStorageProtection({ persisted: async () => false })).toBe('not-granted');
});

it('reports unsupported and unknown states', async () => {
  expect(await checkStorageProtection(undefined)).toBe('unsupported');
  expect(await checkStorageProtection({ persisted: async () => { throw new Error('blocked'); } })).toBe('unknown');
});
```

- [ ] **Step 2: 运行测试确认缺少模块**

Run: `npm test -- src/data/browser-storage.test.ts`

Expected: FAIL，提示无法解析 `./browser-storage`。

- [ ] **Step 3: 实现状态检查与用户触发申请**

```ts
export type StorageProtectionState =
  | 'checking' | 'granted' | 'not-granted' | 'unsupported' | 'unknown';

export async function checkStorageProtection(
  storage = navigator.storage as Pick<StorageManager, 'persisted'> | undefined,
): Promise<StorageProtectionState> {
  if (!storage?.persisted) return 'unsupported';
  try { return await storage.persisted() ? 'granted' : 'not-granted'; }
  catch { return 'unknown'; }
}

export async function requestStorageProtection(
  storage = navigator.storage as Pick<StorageManager, 'persist'> | undefined,
): Promise<boolean> {
  if (!storage?.persist) return false;
  return storage.persist();
}
```

`App.tsx` 首次加载调用 `checkStorageProtection()`；点击操作调用 `requestStorageProtection()` 后再次检查真实状态。不得在加载时调用 `persist()`。

- [ ] **Step 4: 写失败的设置页状态测试**

```tsx
it('describes storage protection without a permanent guarantee', () => {
  render(<SettingsPage model={{ ...settingsModel, storageProtection: 'not-granted' }} timezone="Asia/Shanghai" actions={makeSettingsActions()} />);
  expect(screen.getByRole('heading', { name: '防自动清理保护' })).toBeInTheDocument();
  expect(screen.getByText(/不能防止主动清除网站数据/)).toBeInTheDocument();
  expect(screen.queryByText(/永久存储/)).not.toBeInTheDocument();
});
```

- [ ] **Step 5: 实现设置页状态卡**

状态文字固定为：

- `checking`：`正在检查浏览器保护状态…`
- `granted`：`已获得防自动清理保护`
- `not-granted`：`尚未获得防自动清理保护`
- `unsupported`：`当前浏览器不支持此项保护`
- `unknown`：`暂时无法确认保护状态`

仅 `not-granted` 和 `unknown` 显示“请求防自动清理保护”按钮。卡片始终显示：`此保护只能降低浏览器因空间不足自动清理数据的风险，不能防止主动清除网站数据、卸载浏览器、换机或设备损坏。`

- [ ] **Step 6: 验证聚焦测试并提交**

Run: `npm test -- src/data/browser-storage.test.ts src/components/components.test.tsx`

Expected: PASS。

```powershell
git add sleep-log/src/data/browser-storage.ts sleep-log/src/data/browser-storage.test.ts sleep-log/src/App.tsx sleep-log/src/components/SettingsPage.tsx sleep-log/src/components/components.test.tsx
git commit -m "feat: show truthful browser storage protection"
```

### Task 3: 加固 JSON 与 CSV 下载反馈

**Files:**
- Modify: `sleep-log/src/data/file-backup.ts`
- Modify: `sleep-log/src/data/file-backup.test.ts`
- Modify: `sleep-log/src/App.tsx`
- Modify: `sleep-log/src/components/SettingsPage.tsx`
- Modify: `sleep-log/src/components/components.test.tsx`

**Interfaces:**
- Produces: `downloadBackup(text: string, filename: string, mimeType?: string): void`，成功触发或抛错。
- `SettingsActions.exportCsv()` 改为 `Promise<void>`。

- [ ] **Step 1: 写失败的下载生命周期测试**

```ts
it('attaches the link, clicks it, removes it and revokes the URL later', () => {
  vi.useFakeTimers();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  const append = vi.spyOn(document.body, 'appendChild');
  const remove = vi.spyOn(HTMLElement.prototype, 'remove');
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  downloadBackup('{}', '眠记.json');
  expect(append).toHaveBeenCalled();
  expect(click).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(revoke).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: 运行测试确认当前实现失败**

Run: `npm test -- src/data/file-backup.test.ts -t "attaches the link"`

Expected: FAIL，因为当前链接未加入 DOM 且立即释放 URL。

- [ ] **Step 3: 实现完整下载生命周期**

```ts
export function downloadBackup(text: string, filename: string, mimeType = 'application/json;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
```

- [ ] **Step 4: 覆盖导出失败状态**

组件测试让 `actions.exportJson` 和 `actions.exportCsv` 分别拒绝 Promise，断言页面显示“导出失败，请重试”。`App.tsx` 使用统一异常处理调用下载；JSON 只有下载触发和状态写入完成后才刷新 `lastManualExportAt`。

- [ ] **Step 5: 验证并提交**

Run: `npm test -- src/data/file-backup.test.ts src/components/components.test.tsx; npm run test:e2e`

Expected: 所有测试通过。

```powershell
git add sleep-log/src/data/file-backup.ts sleep-log/src/data/file-backup.test.ts sleep-log/src/App.tsx sleep-log/src/components/SettingsPage.tsx sleep-log/src/components/components.test.tsx
git commit -m "fix: harden browser backup downloads"
```

### Task 4: 修正网页版反馈与隐私说明

**Files:**
- Modify: `sleep-log/src/components/SettingsPage.tsx`
- Modify: `sleep-log/src/components/components.test.tsx`
- Modify: `sleep-log/README.md`
- Modify: `sleep-log/docs/PRIVACY_AND_BACKUP.md`

**Interfaces:**
- Produces用户可见说明：`仅在您点击提交时，反馈内容、选填联系方式和提交时间会发送至第三方邮件转发服务；不会附带或上传睡眠记录。`

- [ ] **Step 1: 写失败的隐私文案测试**

```tsx
it('explains exactly what feedback submission sends', () => {
  render(<SettingsPage model={settingsModel} timezone="Asia/Shanghai" actions={makeSettingsActions()} />);
  expect(screen.getByText(/不会附带或上传睡眠记录/)).toBeInTheDocument();
  expect(screen.getByText(/第三方邮件转发服务/)).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认缺少说明**

Run: `npm test -- src/components/components.test.tsx -t "explains exactly"`

Expected: FAIL，找不到隐私边界文字。

- [ ] **Step 3: 更新界面和文档**

在反馈表单前加入约定文字。README 和隐私文档将“零数据上报”改为：`睡眠记录只保存在本机，不会自动上传；仅当用户主动提交意见时，反馈正文、选填联系方式和提交时间会发送至第三方邮件转发服务。`

保留 APP 文档文件，但在原生对比文档顶部注明：`原生 APP 方案已暂停，本文件仅保留为历史设计，不代表当前交付能力。`

- [ ] **Step 4: 验证并提交**

Run: `npm test -- src/components/components.test.tsx`

Expected: PASS。

```powershell
git add sleep-log/src/components/SettingsPage.tsx sleep-log/src/components/components.test.tsx sleep-log/README.md sleep-log/docs/PRIVACY_AND_BACKUP.md
git commit -m "docs: clarify web feedback privacy boundary"
```

### Task 5: 完整验证并生成网页版上线包

**Files:**
- Modify: `sleep-log/package.json`
- Create on Desktop: `E:\桌面\mianji-网页版PWA_优化加固版.zip`

**Interfaces:**
- `npm run check` 依次执行单元/组件测试、生产构建、网页产物隔离检查和 Playwright 流程。

- [ ] **Step 1: 把产物检查纳入完整命令**

`package.json` 的完整命令设为：

```json
"check": "npm run test && npm run build && npm run check:web-bundle && npm run test:e2e"
```

- [ ] **Step 2: 运行完整验证**

Run: `npm run check`

Expected: Vitest、TypeScript/Vite、网页原生模块隔离检查和 Playwright 全部通过。

- [ ] **Step 3: 检查工作区和生产资源**

Run: `git diff --check; git status --short; Get-ChildItem dist -Recurse -File`

Expected: 无空白错误；只包含本计划相关变更；`dist` 包含 HTML、CSS、JavaScript、图标、manifest 和 Service Worker。

- [ ] **Step 4: 生成并校验上线包**

用 PowerShell `Compress-Archive` 将 `sleep-log/dist` 内文件压缩到 `E:\桌面\mianji-网页版PWA_优化加固版.zip`；若同名文件已存在，创建带递增后缀的新文件，禁止覆盖。随后使用 `System.IO.Compression.ZipFile.OpenRead()` 确认所有条目可读取，并记录 SHA-256。

- [ ] **Step 5: 提交**

```powershell
git add sleep-log/package.json
git commit -m "chore: verify web-only release bundle"
```

## Plan Self-Review

- **Spec coverage:** Task 1 隔离原生模块；Task 2 实现诚实的浏览器防自动清理保护；Task 3 加固外部备份下载；Task 4 修正反馈联网与隐私说明；Task 5 完成全量验证和纯网页版打包。
- **Completeness scan:** 所有行为、文字、函数签名、命令和期望结果均已明确。
- **Type consistency:** `StorageProtectionState` 由数据层产生，经 `SettingsModel` 展示；导出操作的 Promise 类型与错误处理一致；网页入口只构造现有 `SleepRepository` 实现。
