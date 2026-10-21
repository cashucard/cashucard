/* eslint-env node, es2020 */
/* Private environment inputs only; never print their values or keystore paths. */
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const fields = [
  'CASHU_ANDROID_UPLOAD_KEYSTORE',
  'CASHU_ANDROID_UPLOAD_STORE_PASSWORD',
  'CASHU_ANDROID_UPLOAD_KEY_ALIAS',
  'CASHU_ANDROID_UPLOAD_KEY_PASSWORD',
];
function checkAndroidSigning(env = process.env) {
  if (fields.some(name => typeof env[name] !== 'string' || !env[name].trim())) {
    throw new Error(
      'Release signing requires all four CASHU_ANDROID_UPLOAD_* inputs.',
    );
  }
  const file = env.CASHU_ANDROID_UPLOAD_KEYSTORE;
  if (!path.isAbsolute(file)) {
    throw new Error('Upload keystore must use an absolute private path.');
  }
  let bytes;
  try {
    if (!fs.statSync(file).isFile()) {
      throw new Error();
    }
    bytes = fs.readFileSync(file);
  } catch {
    throw new Error('Upload keystore must be a readable file.');
  }
  if (bytes.length === 0) {
    throw new Error('Upload keystore is empty.');
  }
  const debug = fs.readFileSync(
    path.resolve(__dirname, '../android/app/debug.keystore'),
  );
  const digest = value => createHash('sha256').update(value).digest('hex');
  if (digest(bytes) === digest(debug)) {
    throw new Error('The published debug keystore cannot sign a release.');
  }
}
module.exports = {checkAndroidSigning};
if (require.main === module) {
  try {
    checkAndroidSigning();
    process.stdout.write('Private Android upload signing inputs validated.\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
