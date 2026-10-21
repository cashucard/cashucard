import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const {checkAndroidSigning} = require('../scripts/check-android-signing.cjs');

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cashu-signing-'));
});
afterEach(() => fs.rmSync(root, {recursive: true, force: true}));
function inputs(file: string) {
  return {
    CASHU_ANDROID_UPLOAD_KEYSTORE: file,
    CASHU_ANDROID_UPLOAD_STORE_PASSWORD: 'public-test-store-password',
    CASHU_ANDROID_UPLOAD_KEY_ALIAS: 'public-test-alias',
    CASHU_ANDROID_UPLOAD_KEY_PASSWORD: 'public-test-key-password',
  };
}
test('release signing requires complete private inputs and a readable absolute file', () => {
  expect(() => checkAndroidSigning({})).toThrow('all four');
  expect(() => checkAndroidSigning(inputs('relative.keystore'))).toThrow(
    'absolute',
  );
  expect(() => checkAndroidSigning(inputs(path.join(root, 'missing')))).toThrow(
    'readable',
  );
  expect(() => checkAndroidSigning(inputs(root))).toThrow('readable');
  const file = path.join(root, 'test.keystore');
  fs.writeFileSync(file, '');
  expect(() => checkAndroidSigning(inputs(file))).toThrow('empty');
  fs.writeFileSync(
    file,
    'synthetic opaque bytes; AGP validates the actual key format',
  );
  expect(() => checkAndroidSigning(inputs(file))).not.toThrow();
});
test('a renamed copy of the published debug key is rejected without echoing private inputs', () => {
  const file = path.join(root, 'sensitive-private-path.keystore');
  fs.copyFileSync(
    path.resolve(__dirname, '../android/app/debug.keystore'),
    file,
  );
  let message = '';
  try {
    checkAndroidSigning(inputs(file));
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toBe('The published debug keystore cannot sign a release.');
  for (const value of Object.values(inputs(file))) {
    expect(message).not.toContain(value);
  }
});
