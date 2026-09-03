import { describe, expect, it } from 'vitest';
import config from '../../capacitor.config';

describe('Capacitor configuration', () => {
  it('uses the stable mobile id and built web directory', () => {
    expect(config.appId).toBe('com.mianji.sleep');
    expect(config.webDir).toBe('dist');
    expect(config.appName).toBe('眠记');
  });
});
