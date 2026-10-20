/** Shared test wiring: an in-memory DB with a fixed master and clock. */
import {OpsDb} from '../src/db';

export const TEST_MASTER = Buffer.alloc(32, 0x5a);

let counter = 0;

export function testDb(): OpsDb {
  counter++;
  return new OpsDb({
    path: ':memory:',
    randomBytes: n => {
      // deterministic but distinct per call
      const buf = Buffer.alloc(n);
      for (let i = 0; i < n; i++) {
        buf[i] = (counter * 7 + i * 13 + 1) & 0xff;
      }
      return buf;
    },
    now: () => 1_700_000_000,
    master: {getMaster: () => TEST_MASTER},
  });
}
