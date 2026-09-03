import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite } from '@capacitor-community/sqlite';
import { IndexedDbSleepRepository, type SleepRepository } from './repository';
import { NativeSqliteSleepRepository, type SqliteAdapter } from './native-sqlite-repository';

export async function createSleepRepository(customAdapter?: SqliteAdapter): Promise<SleepRepository> {
  if (customAdapter) {
    const repo = new NativeSqliteSleepRepository(customAdapter);
    await repo.initialize();
    return repo;
  }
  if (Capacitor.isNativePlatform()) {
    try {
      const dbName = 'mianji_sleep';
      await CapacitorSQLite.createConnection({
        database: dbName,
        encrypted: false,
        mode: 'no-encryption',
        version: 1,
        readonly: false,
      });
      await CapacitorSQLite.open({ database: dbName, readonly: false });

      let inManualTransaction = false;

      const adapter: SqliteAdapter = {
        async execute(sql: string, values?: unknown[]): Promise<void> {
          if (values && values.length > 0) {
            await CapacitorSQLite.run({
              database: dbName,
              statement: sql,
              values: values as any[],
              transaction: !inManualTransaction,
            });
          } else {
            await CapacitorSQLite.execute({
              database: dbName,
              statements: sql,
              transaction: !inManualTransaction,
            });
          }
        },
        async query<T>(sql: string, values?: unknown[]): Promise<T[]> {
          const res = await CapacitorSQLite.query({
            database: dbName,
            statement: sql,
            values: (values ?? []) as any[],
          });
          return (res.values ?? []) as T[];
        },
        async transaction<T>(operation: () => Promise<T>): Promise<T> {
          if (inManualTransaction) {
            return operation();
          }
          inManualTransaction = true;
          try {
            await CapacitorSQLite.beginTransaction({ database: dbName });
            const result = await operation();
            await CapacitorSQLite.commitTransaction({ database: dbName });
            return result;
          } catch (error) {
            try {
              await CapacitorSQLite.rollbackTransaction({ database: dbName });
            } catch {
              // Ignore rollback errors if transaction was already closed
            }
            throw error;
          } finally {
            inManualTransaction = false;
          }
        },
      };

      const repo = new NativeSqliteSleepRepository(adapter);
      await repo.initialize();
      return repo;
    } catch (err) {
      console.warn('Native SQLite 初始化失败，自动降级为 IndexedDb 存储:', err);
      return new IndexedDbSleepRepository();
    }
  }
  return new IndexedDbSleepRepository();
}

