/**
 * A card maker for the tests: every test that installs a card passes the
 * installation gate the way the app does (releaseGates.ts), with a maker of
 * its own. No production code reads this file.
 */
import {cashuPlanFor} from '../src/cardkit';
import {
  encodeSavedMaker,
  type MakerChoice,
  type MakerStorage,
} from '../src/maker';
import {installGate, type InstallMaker} from '../src/releaseGates';

export const TEST_MAKER: MakerChoice = {
  name: 'Test Card Works',
  tagAddress: 'https://cards.testworks.dev/card',
};
/** The shared repository's maker file, as the gate sees it. */
export const EXAMPLE_FILE = {
  example: true,
  name: 'Example card maker',
  tagAddress: 'https://example.com/card',
};

/** `choice` through the gate; throws when the gate refuses it. */
export function gatedMaker(choice: MakerChoice = TEST_MAKER): InstallMaker {
  const gate = installGate({
    loadFileValidated: true,
    saved: choice,
    file: EXAMPLE_FILE,
  });
  if (!gate.allowed) {
    throw new Error(gate.problem);
  }
  return gate.maker;
}

/** The card plan the tests install, built from the gated test maker. */
export const CASHU_PLAN = cashuPlanFor(gatedMaker());

/** A phone's maker storage, holding `initial` for every ops service (null: none saved). */
export function makerStorageWith(
  initial: MakerChoice | null = TEST_MAKER,
): MakerStorage & {saved: Map<string, string>} {
  const saved = new Map<string, string>();
  return {
    saved,
    read: async origin =>
      saved.get(origin) ?? (initial ? encodeSavedMaker(initial) : null),
    write: async (origin, value) => {
      saved.set(origin, value);
    },
  };
}

/** The gate's answers, for tests that stand in for the provisioning store. */
export const OPEN_GATE = {
  allowed: true as const,
  source: 'profile' as const,
  maker: gatedMaker(),
};
export const CLOSED_GATE = installGate({
  loadFileValidated: false,
  saved: null,
  file: EXAMPLE_FILE,
});
