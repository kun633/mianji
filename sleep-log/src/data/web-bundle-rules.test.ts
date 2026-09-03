import { describe, expect, it } from 'vitest';
import { findForbiddenNativeTokens } from '../../scripts/web-bundle-rules.mjs';

describe('web bundle rules', () => {
  it('rejects generic Capacitor runtime code as well as native bridges', () => {
    expect(findForbiddenNativeTokens('registerPlugin("Capacitor")')).toContain('Capacitor');
    expect(findForbiddenNativeTokens('SleepWidgetBridge')).toContain('SleepWidgetBridge');
    expect(findForbiddenNativeTokens('ordinary web bundle')).toEqual([]);
  });
});
