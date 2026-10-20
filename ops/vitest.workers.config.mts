/**
 * The Workers-side test config: vitest inside workerd via the official
 * plugin, with the DO defined in the same Worker (main) — the tests drive
 * OpsStore over `cloudflare:test`'s helpers exactly as production would.
 * Secrets come from the config's miniflare overrides, never from wrangler.
 */
import {cloudflareTest} from '@cloudflare/vitest-plugin';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/worker.ts',
      wrangler: {configPath: './wrangler.toml'},
      miniflare: {
        r2Buckets: ['OPS_BACKUPS'],
        // OPS_MASTER_KEY: a TEST master, the same fixed value the node tests
        // use; never a real secret in the tree.
        bindings: {
          OPS_MASTER_KEY: '5a'.repeat(32),
          OPS_BACKUP_RECIPIENT:
            'age1kzny9tq55ygrunlrtqv4pmflnquer4xtktkx494wxwz6kermvcuql9acra',
          OPS_OPERATOR_SETUP: JSON.stringify({
            action: 'bootstrap',
            nonce: 'workers_setup_nonce_001',
            name: 'lead-setup',
            password: 'correct horse battery',
          }),
        },
      },
    }),
  ],
  test: {
    include: ['test/workers/**/*.test.ts'],
  },
});
