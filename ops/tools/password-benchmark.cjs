/* Public fixtures only. Local workerd; no accounts, credentials or remote bindings. */
const {build} = require('esbuild');
const {Miniflare, Log, LogLevel} = require('miniflare');
const {performance} = require('node:perf_hooks');
const path = require('node:path');

async function main() {
  const bundled = await build({
    stdin: {
      contents: `import {NativePwHash} from './src/pwhash';
        import {pbkdf2Async} from '@noble/hashes/pbkdf2';
        import {sha256} from '@noble/hashes/sha256';
        export default {async fetch(req){
          const password='public benchmark fixture; never an operator password';
          if(new URL(req.url).pathname==='/native') {
            const value=await new NativePwHash().hash(password);
            if(!value.startsWith('scrypt$16384$8$5$'))throw new Error('Native profile unavailable');
            return Response.json({verified:true});
          }
          const value=await pbkdf2Async(sha256,password,new Uint8Array(16).fill(90),{c:600000,dkLen:64});
          return Response.json({verified:value.length===64});
        }};`,
      resolveDir: path.resolve(__dirname, '..'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    external: ['node:crypto'],
  });
  const worker = new Miniflare({
    workers: [
      {
        config: {
          name: 'public-password-benchmark',
          compatibilityDate: '2026-10-13',
          compatibilityFlags: ['nodejs_compat'],
          manifest: {
            mainModule: 'worker.js',
            modules: {
              'worker.js': {type: 'esm', contents: bundled.outputFiles[0].text},
            },
          },
        },
      },
    ],
    log: new Log(LogLevel.NONE),
  });
  try {
    await worker.ready;
    for (const mode of [
      'native',
      'fallback',
      'native',
      'fallback',
      'native',
      'fallback',
    ]) {
      const start = performance.now();
      const r = await worker.dispatchFetch('http://benchmark.invalid/' + mode, {
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok || !(await r.json()).verified)
        throw new Error('Local benchmark failed');
      console.log(
        JSON.stringify({
          runtime: 'local-workerd',
          fixture: 'public-test-only',
          mode,
          elapsed_ms: Math.round(performance.now() - start),
        }),
      );
    }
  } finally {
    await worker.dispose();
  }
}
main().catch(() => {
  console.error('Local password benchmark stopped.');
  process.exitCode = 1;
});
