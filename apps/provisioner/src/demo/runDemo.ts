/**
 * Demo runs: the designed screens driving cardkit's provision() against the
 * fake card, at the real cadence, with the real events. Nothing here is
 * reachable in a build that has demo mode off.
 */
import {
  CASHU_PLAN,
  provision,
  type ProvisionResult,
  type RunEvent,
} from '../cardkit';
import {fakeCard, type FakeCardProfile} from './fakeCard';
import type {DemoStateId} from '../strings';

export const SCENARIO_PROFILE: Record<DemoStateId, FakeCardProfile | 'noApdu'> = {
  ok: {installed: 'none'},
  pulled: {installed: 'none', pullAtBlock: 35},
  hasValue: {installed: 'holdsValue'},
  hasOld: {installed: 'empty'},
  oldVersion: {installed: 'old'},
  wrongKeys: {installed: 'none', keys: 'spike'},
  noSession: 'noApdu',
};

/** A demo run ends with the fake card's own report, for the run's record row. */
export interface DemoRun {
  state: DemoStateId;
  result: ProvisionResult | null; // null: the session-failure state sends nothing
  sessionError?: string;
}

/**
 * Runs one demo state. `continueReplace` reruns a guarded state with Replace
 * on, the operator's answer to "Remove it and reuse the card?".
 */
export async function runDemo(
  state: DemoStateId,
  {
    replace = false,
    speed = 1,
    onEvent,
  }: {
    replace?: boolean;
    speed?: number;
    onEvent: (e: RunEvent) => void;
  },
): Promise<DemoRun> {
  if (state === 'noSession') {
    return {
      state,
      result: null,
      sessionError: 'No card session: TagConnectionLost.',
    };
  }
  const profile = SCENARIO_PROFILE[state] as FakeCardProfile;
  const fake = fakeCard(profile, {speed});
  const result = await provision(fake.tx, CASHU_PLAN, {
    replace: replace || profile.installed === 'none' || profile.installed === 'holdsValue',
    // a torn run (pulled) and a blank card need no Replace decision; nothing
    // guards holdsValue (it stops before replace is read); hasOld/oldVersion
    // continue only from their action button, which passes replace
    random: len => new Array(len).fill(0x5a),
    now: Date.now,
    onEvent,
  });
  return {state, result};
}

/** Which stop the loop shows for a demo run's result. */
export function stopFor(run: DemoRun): DemoStateId | 'ok' {
  if (run.sessionError) {
    return 'noSession';
  }
  const r = run.result!;
  if (r.ok) {
    return 'ok';
  }
  switch (r.kind) {
    case 'pulled':
      return 'pulled';
    case 'wrongKeys':
      return 'wrongKeys';
    case 'guarded':
      // the demo's guard is one of the two replace states, named by the card
      // the chooser picked; the run's own reason decides for real runs
      if (r.reason?.includes('holds')) {
        return 'hasValue';
      }
      return run.state === 'oldVersion' ? 'oldVersion' : 'hasOld';
    default:
      return 'noSession';
  }
}
