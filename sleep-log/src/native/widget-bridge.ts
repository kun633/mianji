import { Capacitor, registerPlugin } from '@capacitor/core';

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

export interface NativeExportResult {
  success: boolean;
  savedPath?: string;
}

interface SleepWidgetPlugin {
  updateWidgetState(options: {
    state?: string;
    headline: string;
    subline: string;
    actionText: string;
    startTimeMs?: number;
  }): Promise<void>;
  openAppSettings(): Promise<void>;
  exportFile?(options: {
    content: string;
    filename: string;
    mimeType: string;
    title: string;
  }): Promise<NativeExportResult>;
  consumePendingAction?(): Promise<{ action: string | null }>;
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

export async function checkPendingNativeAction(): Promise<string | null> {
  try {
    if (Capacitor.isNativePlatform() && typeof SleepWidgetBridge.consumePendingAction === 'function') {
      const res = await SleepWidgetBridge.consumePendingAction();
      return res?.action ?? null;
    }
  } catch (error) {
    console.error('checkPendingNativeAction error:', error);
  }
  return null;
}

export async function nativeExportFile(options: {
  content: string;
  filename: string;
  mimeType: string;
  title: string;
}): Promise<NativeExportResult | null> {
  try {
    if (Capacitor.isNativePlatform() && typeof SleepWidgetBridge.exportFile === 'function') {
      return await SleepWidgetBridge.exportFile(options);
    }
  } catch (error) {
    console.error('nativeExportFile error:', error);
  }
  return null;
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
        state: payload.state,
        headline: payload.headline,
        subline: payload.subline,
        actionText: actionTextMap[payload.actionType] ?? '打开应用',
        startTimeMs: payload.startTimeMs,
      });
    }
  } catch {
    // Ignore native bridge errors in unsupported environments
  }
}
