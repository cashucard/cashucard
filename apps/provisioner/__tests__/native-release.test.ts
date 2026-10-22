import {spawnSync} from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

test('the actual Xcode bundle phase checks Release configuration before invoking the bundler', () => {
  const app = resolve(__dirname, '..');
  const project = readFileSync(
    join(app, 'ios/CashuProvisioner.xcodeproj/project.pbxproj'),
    'utf8',
  );
  const phase = project.split(
    '/* Begin PBXShellScriptBuildPhase section */',
  )[1];
  const command = JSON.parse(phase.match(/shellScript = (".*");/)![1]);
  const temporary = mkdtempSync(join(tmpdir(), 'cashu-native-release-'));
  const dir = join(temporary, 'app with spaces');
  try {
    for (const name of ['ios', 'scripts', 'src', 'rn/scripts/xcode']) {
      mkdirSync(join(dir, name), {recursive: true});
    }
    for (const name of ['configure-service.cjs', 'bundle-ios.sh']) {
      if (existsSync(join(app, 'scripts', name))) {
        copyFileSync(join(app, 'scripts', name), join(dir, 'scripts', name));
      }
    }
    symlinkSync(join(app, 'node_modules'), join(dir, 'node_modules'), 'dir');
    // Fake only the external React Native environment loader and bundler.
    // Execute the project's actual shell phase and the real config validator.
    writeFileSync(
      join(dir, 'rn/scripts/xcode/with-environment.sh'),
      '#!/bin/bash\nexport NODE_BINARY="$TEST_NODE"\nif [ -n "$1" ]; then "$1"; fi\n',
      {mode: 0o755},
    );
    writeFileSync(
      join(dir, 'rn/scripts/react-native-xcode.sh'),
      '#!/bin/bash\nprintf "bundler-invoked\\n"\n',
      {mode: 0o755},
    );
    const run = (configuration: string, origin: string, drills: boolean) => {
      writeFileSync(
        join(dir, 'src/serviceOrigin.json'),
        JSON.stringify({serviceOrigin: origin}),
      );
      writeFileSync(
        join(dir, 'src/releaseGates.ts'),
        `export const RECOVERY_DRILLS_ENABLED = ${drills};`,
      );
      return spawnSync('/bin/sh', ['-c', command], {
        encoding: 'utf8',
        env: {
          ...process.env,
          CONFIGURATION: configuration,
          SRCROOT: join(dir, 'ios'),
          REACT_NATIVE_PATH: join(dir, 'rn'),
          TEST_NODE: process.execPath,
        },
      });
    };
    for (const [origin, drills] of [
      ['http://127.0.0.1:8821', false],
      ['https://ops.example.com', true],
    ] as const) {
      const result = run('Release', origin, drills);
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain('bundler-invoked');
    }
    for (const configuration of ['Release', 'StoreRelease']) {
      const result = run(configuration, 'https://ops.example.com', false);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('bundler-invoked');
    }
    const debug = run('Debug', 'http://127.0.0.1:8821', true);
    expect(debug.status).toBe(0);
    expect(debug.stdout).toContain('bundler-invoked');
  } finally {
    rmSync(temporary, {recursive: true});
  }
});
