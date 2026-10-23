import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import appInfo from '../package.json';

test('displayed release identity matches both native store builds', () => {
  const app = resolve(__dirname, '..');
  const android = readFileSync(
    resolve(app, 'android/app/build.gradle'),
    'utf8',
  );
  const ios = readFileSync(
    resolve(app, 'ios/CashuProvisioner.xcodeproj/project.pbxproj'),
    'utf8',
  );
  expect(android).toContain(`versionCode ${appInfo.provisionerBuild}`);
  expect(android).toContain(`versionName "${appInfo.version}"`);
  expect(ios).toContain(
    `CURRENT_PROJECT_VERSION = ${appInfo.provisionerBuild};`,
  );
});
