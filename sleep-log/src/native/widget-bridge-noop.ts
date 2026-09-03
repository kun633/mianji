export interface WidgetStatePayload {
  state: 'idle' | 'active' | 'finished';
  headline: string;
  subline: string;
  actionType: 'start' | 'wake' | 'view';
  updatedAt: string;
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
