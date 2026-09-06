import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite } from '@capacitor-community/sqlite';
import { IndexedDbSleepRepository, type SleepRepository } from './repository';
import { NativeSqliteSleepRepository, type SqliteAdapter } from './native-sqlite-repository';

// SQLite's connection/transaction is shared. Queue every public operation so a
// second UI action cannot enter (or roll back) the first action's transaction.
function serializeRepository(repo: SleepRepository): SleepRepository {
  let tail: Promise<unknown> = Promise.resolve();
  const run = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  };
  return {
    get: id => run(() => repo.get(id)),
    list: () => run(() => repo.list()),
    getActive: () => run(() => repo.getActive()),
    createActiveIfNone: segment => run(() => repo.createActiveIfNone(segment)),
    save: segment => run(() => repo.save(segment)),
    remove: id => run(() => repo.remove(id)),
    replaceAll: segments => run(() => repo.replaceAll(segments)),
    replaceAllIfUnchanged: (expected, segments) => run(() => repo.replaceAllIfUnchanged(expected, segments)),
  };
}

export async function createSleepRepository(customAdapter?: SqliteAdapter): Promise<SleepRepository> {
  if (customAdapter) {
    const repo = new NativeSqliteSleepRepository(customAdapter);
    await repo.initialize();
    return repo;
  }
  if (Capacitor.isNativePlatform()) {
    try {
      const dbName = 'mianji_sleep';
      const existing = await CapacitorSQLite.checkConnectionsConsistency({
        dbNames: [dbName], openModes: ['RW'],
      });
      if (!existing.result) await CapacitorSQLite.createConnection({
        database: dbName,
        encrypted: false,
        mode: 'no-encryption',
        version: 1,
        readonly: false,
      });
      const isOpen = existing.result && (await CapacitorSQLite.isDBOpen({database: dbName, readonly: false})).result;
      if (!isOpen) await CapacitorSQLite.open({ database: dbName, readonly: false });

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
      return serializeRepository(repo);
    } catch (err) {
      // Do not make existing records appear lost by silently opening another DB.
      throw new Error('本地数据库暂时无法打开，请关闭应用后重试。请勿卸载或清除数据。', { cause: err });
    }
  }
  return new IndexedDbSleepRepository();
}

