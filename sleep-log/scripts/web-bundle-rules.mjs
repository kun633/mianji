export const FORBIDDEN_WEB_BUNDLE_TOKENS = [
  'Capacitor',
  '@capacitor/',
  'SleepWidgetBridge',
  'mianji_sleepSQLite',
];

export function findForbiddenNativeTokens(bundle) {
  return FORBIDDEN_WEB_BUNDLE_TOKENS.filter((token) => bundle.includes(token));
}
