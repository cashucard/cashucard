import {CASHU_LOAD_FILE} from './assets/cashu';
import {makerProblem, type MakerChoice} from './maker';

/**
 * The card load files a chip has installed and the operator approved for
 * distributed internal testing (D74), by the sha256 of the bytes LOADed
 * (CASHU_LOAD_FILE.sha256, which tools/cardkit/make-assets.py generates).
 * Installation is enabled only when this build carries one of them, so a
 * distributed build never installs a load file no chip has taken. After a chip
 * run installs a new load file (the opener, the card applet and the tag, then
 * `cardctl selftest`) and its size and hash are in tools/refcheck.py's SIZES
 * and PROVEN, add its sha256 here in a change of its own, with the operator's
 * approval and the run's hardware report.
 * This gate never certifies mint/owner/PIN personalization or holder readiness.
 */
export const VALIDATED_LOAD_FILE_SHA256S: readonly string[] = [
  // 2.1, 20,068 bytes: installed 2026-10-14, approved for internal build 4 (D74)
  'fe7d8ac31be1284f8a9a6d031cdee9b4690f8d02e0a9ab1fa3bac645f6bc13ee',
  // 2.2, 21,631 bytes: installed 2026-11-06 (ENG-823)
  '28ddfb9d47af16e565f565149a91fddfa7af94ca4bed0ef686e7a6c2fe0285d3',
  // 3.1, 42,741 bytes, released as firmware-v3.1.0 (CAP sha256 4ff8d8a2...): approved by the owner on 2026-11-24
  // for Setup build 16 (ENG-870). On 2026-11-23 that exact file (by sha256) was installed and paid from at a test
  // mint on card 58206920 with desktop tools (GlobalPlatformPro, tools/cardctl and a payment harness), per
  // docs/reports/HARDWARE_TEST_REPORT_2026-11-23_58206920_3.1-review.md. The same day cards 36813121 and 09334220
  // took it, counted by the owner on the contributor's statement and logs, which do not give the file's sha256
  // (D238). On 2026-11-24 the operator installed it with a development-signed build of build 16 on a J3R180
  // keyed for SCP02 and a J3R452 keyed for SCP03 (docs/reports/HARDWARE_TEST_REPORT_2026-11-24_setup-build-16.md).
  // Not shown: a J3R180 keyed for SCP03, and an install by the released files.
  'b2afa9a8128967df04bff02a6120d942d51eb21ea4b32d13e6c98647d13753da',
];

/** Whether `sha256` (hex, either case) is on VALIDATED_LOAD_FILE_SHA256S. */
export function loadFileValidated(sha256: string): boolean {
  return VALIDATED_LOAD_FILE_SHA256S.includes(sha256.toLowerCase());
}

/**
 * The build's half of the installation gate: operator-approved installation
 * for distributed internal testing (D74), this build's load file being a
 * validated one. Fixed when the app is built.
 */
export const LOAD_FILE_VALIDATED = loadFileValidated(CASHU_LOAD_FILE.sha256);

declare const gated: unique symbol;
/**
 * A maker's name and tag address that passed installGate. Only installGate
 * makes one, and the card plan is built from nothing else (cardkit.ts,
 * cashuPlanFor): no address reaches a card without passing the gate.
 */
export type InstallMaker = Readonly<MakerChoice> & {readonly [gated]: true};
/** The frozen objects installGate handed out: the type's mark, kept at run time. */
const passed = new WeakSet<object>();
/** Whether `maker` is an object installGate itself handed out, not a look-alike. */
export function passedInstallGate(maker: unknown): maker is InstallMaker {
  return typeof maker === 'object' && maker !== null && passed.has(maker);
}

export type InstallGate =
  | {allowed: true; maker: InstallMaker}
  | {
      allowed: false;
      reason:
        | 'load-file'
        | 'maker-reading'
        | 'maker-unread'
        | 'no-maker'
        | 'bad-maker';
      /** Words for the person making cards; empty while the setting is being read. */
      problem: string;
    };

export const GATE_WORDS = {
  loadFile:
    'Installation is unavailable in this build. Ask your administrator for an installation-enabled release.',
  unread:
    'The card maker saved on this phone could not be read. Set it again in Settings. No card is installed until then.',
  none: 'Set the card maker first. No card is installed until a maker name and a tag address are saved.',
  /** The phone's setting is still being read: nothing to say yet, nothing installs. */
  reading: '',
};

/**
 * The installation gate (D74, D239). What LOADs the card's file (a batch and
 * its installs) wants both halves:
 *  - `loadFileValidated`: the build's load file is on the approved list;
 *  - a maker's own name and a tag address that keeps the rules (maker.ts),
 *    saved on this phone for the active ops service (`saved`). `null` means
 *    that service has none saved: nothing installs. A fork's own maker file
 *    only pre-fills the Card maker form; it opens no gate.
 * `saved` undefined means the phone's setting cannot be read, and `reading`
 * that it is not read yet: nothing installs in either case. A saved maker
 * that breaks a rule is refused.
 * This gates no owned-card reset, which removes an installation and restores
 * the manager keys without loading anything.
 */
export function installGate(input: {
  loadFileValidated: boolean;
  saved: MakerChoice | null | undefined;
  /** The first read of the phone's setting is still in flight. */
  reading?: boolean;
}): InstallGate {
  if (input.loadFileValidated !== true) {
    return {allowed: false, reason: 'load-file', problem: GATE_WORDS.loadFile};
  }
  if (input.reading === true) {
    return {
      allowed: false,
      reason: 'maker-reading',
      problem: GATE_WORDS.reading,
    };
  }
  if (input.saved === undefined) {
    return {allowed: false, reason: 'maker-unread', problem: GATE_WORDS.unread};
  }
  const choice = input.saved;
  if (choice === null) {
    return {allowed: false, reason: 'no-maker', problem: GATE_WORDS.none};
  }
  const problem = makerProblem(choice.name, choice.tagAddress);
  if (problem) {
    return {allowed: false, reason: 'bad-maker', problem};
  }
  const maker = Object.freeze({
    name: choice.name,
    tagAddress: choice.tagAddress,
  }) as InstallMaker;
  passed.add(maker);
  return {allowed: true, maker};
}

/** Local validation builds only (including owner-built iOS Release binaries).
 * Never enable in a production commit or distribute an enabled validation build.
 * This flag does not bypass the installation gate (installGate).
 */
export const RECOVERY_DRILLS_ENABLED = false;

/** Spare-card laboratory tools only. Never enable in a distributed Release. */
export const BENCH_RUNS_ENABLED = false;

/**
 * What the bench screen may run. Every bench action wants BENCH_RUNS_ENABLED.
 * Installing the Cashu card's load file also wants LOAD_FILE_VALIDATED, so a
 * bench build never installs a load file no chip has taken, and the bench
 * screen builds its card plan only from a maker that passed installGate; the chip run
 * that validates a new load file is made with gp and cardctl
 * (docs/HARDWARE_DEPLOYMENT.md), not here. The hello applet and the key
 * rotation install no card load file.
 */
export function benchActionAllowed(
  action: 'hello' | 'cashu' | 'rotate',
  bench = BENCH_RUNS_ENABLED,
  validated = LOAD_FILE_VALIDATED,
): boolean {
  return bench && (action !== 'cashu' || validated);
}
