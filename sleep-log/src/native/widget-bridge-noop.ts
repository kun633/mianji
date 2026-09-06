export interface WidgetStatePayload {
  state: 'idle' | 'active' | 'finished';
  headline: string;
  subline: string;
  actionType: 'start' | 'wake' | 'view';
  updatedAt: string;
  startTimeMs?: number;
}

export interface NativeWidgetBridge {
  send(payload: WidgetStatePayload): Promise<void>;
}

export async function publishWidgetState(
  _payload: WidgetStatePayload,
  _bridge?: NativeWidgetBridge
): Promise<void> {
  // Pure web stub: no native bridge operation
}

export async function openNativeAppSettings(): Promise<void> {
  // Pure web stub
}

export async function checkPendingNativeAction(): Promise<string | null> {
  return null;
}

export async function nativeExportFile(_options: unknown): Promise<null> {
  return null;
}
