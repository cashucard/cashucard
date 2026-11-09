/**
 * Live NIP-87 discovery against the three relays (ENG-832, D180). Not part
 * of PR CI: it reaches public relays and third-party mints, so it runs on
 * demand (`yarn probe:discovery`). Prints what each relay answered and the
 * mints that would be offered. Exits 1 only when no relay answers; an empty
 * discovered set is a fact about the relays, not a failure.
 */
import {DEFAULT_MINTS} from '../../src/config';
import {
  createRelayQuery,
  discoverMints,
  DISCOVERY_RELAYS,
  type RelayQuery,
} from '../../src/discovery';

async function main(): Promise<void> {
  const base = createRelayQuery();
  const query: RelayQuery = async relay => {
    const a = await base(relay);
    console.log(
      `${a.answered ? 'ok  ' : 'FAIL'} ${relay} (${a.events.length} events)`,
    );
    return a;
  };
  const result = await discoverMints({
    query,
    defaults: DEFAULT_MINTS,
    log: (...args) => console.log('    ', ...args),
  });
  if (!result.answered) {
    console.error('no relay answered');
    process.exitCode = 1;
    return;
  }
  console.log(`${result.mints.length} discovered mint(s) would be offered`);
  for (const m of result.mints)
    console.log(
      `  ${m.url} (${m.reviews} reviews)${m.name ? ` ${m.name}` : ''}`,
    );
  console.log(`relays: ${DISCOVERY_RELAYS.join(', ')}`);
}

void main();
