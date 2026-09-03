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
  payload: WidgetStatePayload,
  bridge?: NativeWidgetBridge
): Promise<void> {
  if (bridge) {
    await bridge.send(payload);
    return;
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('mianji_widget_state', JSON.stringify(payload));
    }
  } catch {
    // Ignore storage errors in non-standard environments
  }
}
