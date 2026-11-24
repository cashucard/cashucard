/**
 * The app's adapter to the versioned cardkit package. Firmware load files
 * remain generated, pinned app assets rather than part of the library API.
 */
import {CASHU_LOAD_FILE} from './assets/cashu';
import {HELLO_LOAD_FILE} from './assets/hello';
import {
  cashuPlan,
  helloPlan,
  mayLeaveGuardedApplet,
  type Plan,
} from '@cashu-card/cardkit';
import {makerProblem} from './maker';
import type {InstallMaker} from './releaseGates';

export * from '@cashu-card/cardkit';
// Holder PIN/settlement helpers are explicit: the ops reset runner does not
// import or bundle this mobile-only crypto dependency through the GP barrel.
export * from '@cashu-card/cardkit/cleanup';

/**
 * The card plan, its tag carrying the maker's address. It takes only a maker
 * that passed the installation gate (releaseGates.ts, installGate), and checks
 * the rules once more, so no other address reaches a card (D239).
 */
export function cashuPlanFor(maker: InstallMaker): Plan {
  const problem = makerProblem(maker.name, maker.tagAddress);
  if (problem) {
    throw new RangeError(problem);
  }
  return cashuPlan(CASHU_LOAD_FILE, {tagAddress: maker.tagAddress});
}
/**
 * Whether a run pulled at `phase` may have left the card applet behind. That
 * follows the plan's order of installs, which no tag address changes: the
 * plan built here never leaves this function.
 */
export function cashuMayLeaveGuardedApplet(phase: string): boolean {
  return mayLeaveGuardedApplet(
    cashuPlan(CASHU_LOAD_FILE, {tagAddress: 'https://order-only.invalid/'}),
    phase,
  );
}
export const HELLO_PLAN = helloPlan(HELLO_LOAD_FILE);
