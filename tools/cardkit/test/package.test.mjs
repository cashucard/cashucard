import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '../..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('consumers use the public package, with no private-source or runtime testing imports', () => {
  function visit(dir, production) {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path, production);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        const source = readFileSync(path, 'utf8');
        const imports = [
          ...source.matchAll(/(?:from\s+|require\(\s*)['"]([^'"]+)['"]/g),
        ].map(m => m[1]);
        for (const specifier of imports) {
          assert.ok(
            !specifier.includes('tools/cardkit'),
            `${path}: private cardkit import ${specifier}`,
          );
          if (specifier.startsWith('@cashu-card/cardkit')) {
            assert.ok(
              [
                '@cashu-card/cardkit',
                '@cashu-card/cardkit/cleanup',
                '@cashu-card/cardkit/testing',
              ].includes(specifier),
              `${path}: unsupported API`,
            );
            assert.ok(
              !production || !specifier.endsWith('/testing'),
              `${path}: Node-only fake in runtime code`,
            );
          }
        }
      }
    }
  }
  for (const component of ['ops', 'apps/provisioner']) {
    visit(join(repo, component, 'src'), true);
    visit(
      join(repo, component, component === 'ops' ? 'test' : '__tests__'),
      false,
    );
  }
});

test('the packed API works in ordinary Node and rejects private subpaths', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'cardkit-package-'));
  try {
    // Pack the actual distributable, not a symlink to repository source. Only
    // declared runtime dependencies are supplied from the installed fixture.
    const packed = JSON.parse(
      execFileSync(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch],
        {cwd: root, encoding: 'utf8'},
      ),
    )[0];
    const target = join(scratch, 'node_modules/@cashu-card/cardkit');
    mkdirSync(target, {recursive: true});
    execFileSync('tar', [
      '-xzf',
      join(scratch, packed.filename),
      '--strip-components=1',
      '-C',
      target,
    ]);
    mkdirSync(join(scratch, 'node_modules/@noble'), {recursive: true});
    for (const dependency of ['hashes', 'curves', 'ciphers']) {
      symlinkSync(
        join(root, 'node_modules/@noble', dependency),
        join(scratch, 'node_modules/@noble', dependency),
        'dir',
      );
    }
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        `
      const assert = require('node:assert/strict');
      const api = require('@cashu-card/cardkit');
      const cleanup = require('@cashu-card/cardkit/cleanup');
      const {FakeCard} = require('@cashu-card/cardkit/testing');
      assert.equal(typeof api.provision, 'function');
      assert.equal(typeof api.resetOwnedCard, 'function');
      assert.equal(typeof cleanup.readResetReview, 'function');
      assert.equal(typeof cleanup.cleanupSettledEntries, 'function');
      assert.equal(typeof new FakeCard().transceive, 'function');
      // SCP03's AES comes from the declared @noble/ciphers: 504A77 is the public default's check value
      assert.equal(api.toHex(api.aesKcv(api.FACTORY_KEYS.enc)), '504A77');
      // first contact's two key versions: a J3R452 ships at FF, the public default sits at 01 (D182)
      assert.equal(api.SHIPPED_KVN, 0xff);
      assert.equal(api.FACTORY_KVN, 0x01);
      // and the reopen's read of the key information, GET DATA 00E0 with no secure channel
      assert.deepEqual(api.getKeyInformation(), [0x80, 0xca, 0x00, 0xe0, 0x00]);
      assert.deepEqual(api.parseKeyInformation([0xe0, 0x00]), []);
      assert.equal(new api.Scp03Session({enc: [], mac: [], dek: []}).scp, 3);
      assert.equal(new FakeCard({scp: 3}).scp, 3);
      assert.equal(require('@cashu-card/cardkit/package.json').version, ${JSON.stringify(manifest.version)});
      for (const path of ['gp/scp02', 'gp/scp03', 'gp/apdu', 'gp/test/fake-card', 'dist/gp/reset.js']) {
        assert.throws(() => require('@cashu-card/cardkit/' + path), {code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'});
      }
      assert.equal(api.cleanupSettledEntries, undefined);
      assert.equal(api.FakeCard, undefined);
      console.log('packed API verified');
    `,
      ],
      {cwd: scratch, encoding: 'utf8'},
    );
    assert.match(output, /packed API verified/);
    assert.ok(
      !packed.files.some(file =>
        /gp\/test\/|fixtures\/|\.test\./.test(file.path),
      ),
      'private tests or captures shipped',
    );
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
});
