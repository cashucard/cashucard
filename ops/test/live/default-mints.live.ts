/**
 * Live probe of the code-owned default mint list (ENG-828, D179). Not part
 * of PR CI: it reaches third-party mints, so it runs on demand
 * (`yarn probe:mints`) and from the daily ops-mint-probe workflow.
 * Exits 1 if any default mint fails.
 */
import {DEFAULT_MINTS, probeMint} from '../../src/config';

async function main(): Promise<void> {
  const results = await Promise.all(DEFAULT_MINTS.map(url => probeMint(url)));
  for (const r of results)
    console.log(
      `${r.ok ? 'ok  ' : 'FAIL'} ${r.url}${r.ok ? '' : ` (${r.reason})`}`,
    );
  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) {
    console.error(`${failed.length} of ${results.length} default mints failed`);
    process.exitCode = 1;
  }
}

void main();
