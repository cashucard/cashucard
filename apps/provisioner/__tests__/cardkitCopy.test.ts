/**
 * The app bundles `@cashu-card/cardkit` from node_modules, and yarn copies a
 * `file:` dependency at install time instead of linking it. A change to
 * tools/cardkit therefore does not reach the app until the copy is
 * refreshed, and a stale copy builds the old secure channel with every other
 * test still green, since they run against that copy too. This test fails
 * instead (the same guard as fedimintcard's provisioner, D181). To refresh,
 * after building cardkit:
 *
 *   yarn install --force --frozen-lockfile
 */
import {readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

const SOURCE = resolve(__dirname, '../../../tools/cardkit');
const INSTALLED = dirname(require.resolve('@cashu-card/cardkit/package.json'));

/** What Metro bundles: the package's `react-native` entry points and the engine beside them. */
function bundled(root: string): string[] {
  const gp = readdirSync(join(root, 'gp'))
    .filter(name => name.endsWith('.ts'))
    .map(name => `gp/${name}`);
  return ['index.ts', 'cleanup.ts', ...gp].sort();
}

test('the installed cardkit is the same source as tools/cardkit', () => {
  expect(bundled(INSTALLED)).toEqual(bundled(SOURCE));
  for (const file of bundled(SOURCE)) {
    const same =
      readFileSync(join(INSTALLED, file), 'utf8') ===
      readFileSync(join(SOURCE, file), 'utf8');
    expect([file, same]).toEqual([file, true]);
  }
});
