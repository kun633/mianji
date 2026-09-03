import { Capacitor, registerPlugin } from '@capacitor/core';

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

interface SleepWidgetPlugin {
  updateWidgetState(options: {
    headline: string;
    subline: string;
    actionText: string;
  }): Promise<void>;
  openAppSettings(): Promise<void>;
}

const SleepWidgetBridge = registerPlugin<SleepWidgetPlugin>('SleepWidgetBridge');

export async function openNativeAppSettings(): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await SleepWidgetBridge.openAppSettings();
    }
  } catch {
    // Ignore
  }
}

const actionTextMap: Record<string, string> = {
  start: '打开应用',
  wake: '起床',
  view: '查看记录',
};

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
  try {
    if (Capacitor.isNativePlatform()) {
      await SleepWidgetBridge.updateWidgetState({
        headline: payload.headline,
        subline: payload.subline,
        actionText: actionTextMap[payload.actionType] ?? '打开应用',
      });
    }
  } catch {
    // Ignore native bridge errors in unsupported environments
  }
}
