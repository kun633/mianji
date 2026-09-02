# Task 4 报告：版本化备份、合并、CSV 与外部文件适配器

## 文件

- `sleep-log/src/data/backup.ts`：实现 v1 JSON 备份创建与严格解析、同 ID 冲突检测、内容去重合并，以及带 UTF-8 BOM、中文表头、CRLF 和 CSV 转义的只读导出。
- `sleep-log/src/data/backup.test.ts`：覆盖版本化往返、非法 schema、重复/冲突合并和 CSV 导出。
- `sleep-log/src/data/file-backup.ts`：实现目录能力检测、用户选择目录、自动 JSON 写入、失败隔离、持久化存储请求、手动下载，以及独立 IndexedDB settings store 中的目录句柄和备份状态。
- `sleep-log/src/data/file-backup.test.ts`：覆盖手动降级、外部写入失败、settings 持久化、触发器失败状态和目录读取异常隔离。
- `sleep-log/src/types/file-system-access.d.ts`：补充所需 File System Access API 声明。

外部备份失败会记录状态并吞掉触发器异常，不会让已经完成的本地保存失败；未获授权时标记为 `needs-permission`，不会在非用户手势中主动请求权限。恢复解析和冲突结果由数据层提供，存在冲突时不会产生写入操作。CSV 仅导出，不提供导入路径。

## 测试与构建

- `npm test -- src/data/file-backup.test.ts`：5/5 通过
- `npm test -- src/data`：3 个测试文件、11/11 通过
- `npm test`：5 个测试文件、32/32 通过
- `npm run build`：通过，TypeScript 检查和 Vite 生产构建均成功

## 提交

以上 Task 4 文件与本报告将以一次提交完成，提交信息为：

`feat: add resilient sleep data backups`
