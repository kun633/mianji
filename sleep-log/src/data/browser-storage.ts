export type StorageProtectionState =
  | 'checking'
  | 'granted'
  | 'not-granted'
  | 'unsupported'
  | 'unknown';

type PersistenceReader = Pick<StorageManager, 'persisted'>;
type PersistenceRequester = Pick<StorageManager, 'persist'>;

const browserStorage = (): StorageManager | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator.storage;

export async function checkStorageProtection(
  storage: PersistenceReader | undefined = browserStorage(),
): Promise<StorageProtectionState> {
  if (!storage?.persisted) return 'unsupported';
  try {
    return await storage.persisted() ? 'granted' : 'not-granted';
  } catch {
    return 'unknown';
  }
}

export async function requestStorageProtection(
  storage: PersistenceRequester | undefined = browserStorage(),
): Promise<boolean> {
  if (!storage?.persist) return false;
  return storage.persist();
}
