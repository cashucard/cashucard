/**
 * The install, as a table of phases and one loop over them, and the key
 * rotation. Both run over an injected transceiver, with an injected clock and
 * random source, so the same code runs on the phone and against the fake card
 * in gp/test.
 *
 * Recovery is level-triggered: nothing is remembered between runs. Every run
 * probes the card, logs in, and sweeps whatever a torn run may have left (the
 * instances, newest first, then the package; "not there" is fine) before it
 * loads. Any error ends the run where it is; there is no automatic restart and
 * no retry. The next tap starts again from the probe.
 *
 * Guards, in the order they act:
 * - the load file's sha256 is checked before the first APDU;
 * - a card applet already installed is removed only with `replace` on and
 *   GET_INFO empty (no unspent or spent piece, no owner, no PIN, no record):
 *   a card that holds anything is never swept;
 * - the card's proof of the keys is checked before EXTERNAL AUTHENTICATE
 *   (scp02.ts, and scp03.ts for an SCP03 card);
 * - on an SCP03 card, the J3R452, a sweep of the Cashu AIDs deletes nothing
 *   until the registry shows every Cashu object there as the Cashu package's
 *   (registry.ts): that card ships with the seller's NDEF tag at
 *   D2760000850101, the AID the card's tag takes;
 * - DELETE names only the six AIDs of the whitelist, never the ISD (scp02.ts).
 */
import {sha256} from '@noble/hashes/sha2';

import {
  CARD_AID,
  CARD_VERSION,
  CASHU_PACKAGE_AID,
  HELLO_AID,
  HELLO_PACKAGE_AID,
  ISD_AID,
  OPENER_AID,
  TAG_AID,
  TAG_CLASS_AID,
} from './aids';
import {type Bytes, equal, fromHex, swHex, toHex} from './bytes';
import {RegistryEvidenceError, readCashuRegistry} from './registry';
import {
  CardError,
  FACTORY_KEYS,
  FACTORY_KVN,
  type FreeMemory,
  type KeySet,
  type Random,
  type Reply,
  SHIPPED_KVN,
  type SecureSession,
  type Transceiver,
  TransportError,
  WrongKeys,
  deleteAid,
  externalAuthenticate,
  getFreeMemory,
  initializeUpdate,
  installAndSelectable,
  installForLoad,
  openSession,
  parseFreeMemory,
  putKeys,
  selectAid,
  sessionIfMatches,
  splitLoad,
  transmit,
} from './scp02';

export type Phase =
  | 'probe'
  | 'selectIsd'
  | 'auth'
  | 'sweep'
  | 'installForLoad'
  | 'load'
  | 'installOpener'
  | 'installCard'
  | 'installTag'
  | 'verify'
  | 'done';

/** The phases of an install, in order. A plan may skip some (the hello plan has no probe and one INSTALL). */
export const PHASES: readonly Phase[] = [
  'probe',
  'selectIsd',
  'auth',
  'sweep',
  'installForLoad',
  'load',
  'installOpener',
  'installCard',
  'installTag',
  'verify',
  'done',
];

export type InstallPhase = 'installOpener' | 'installCard' | 'installTag';

export type RotatePhase = 'selectIsd' | 'auth' | 'putKey' | 'reopen' | 'done';

/**
 * Why a run stopped. `pulled`: the reply never came (the card moved, or the
 * phone gave up). `refused`: the card answered with an error. `wrongKeys`: the
 * card did not prove the keys, and nothing was sent after INITIALIZE UPDATE.
 * `guarded`: this module refused before the card was touched further.
 */
export type StopKind = 'pulled' | 'refused' | 'wrongKeys' | 'guarded';

/** A load file as tools/cardkit/make-assets.py writes it. */
export interface LoadFileAsset {
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  readonly hex: string;
}

export interface InstallStep {
  phase: InstallPhase;
  module: Bytes;
  instance: Bytes;
}

/** A plain command to an installed applet, and the answer it must get. */
export interface Check {
  apdu: Bytes;
  /** The data the reply must carry, exactly. */
  data?: Bytes;
  /** The length the reply's data must have. */
  length?: number;
}

export interface Plan {
  name: string;
  loadFile: LoadFileAsset;
  packageAid: Bytes;
  installs: InstallStep[];
  /** DELETE, in this order, at every sweep: the instances newest first, then the package. */
  sweep: Bytes[];
  /** The applet whose GET_INFO guards the sweep: a run never sweeps a card applet that holds anything. */
  guard?: Bytes;
  checks: Check[];
  /** Deleted again after the checks (the hello applet leaves nothing behind). */
  removeAfterChecks?: Bytes[];
  /** LOAD block size; 247 leaves room for the C-MAC in a short APDU. */
  blockSize?: number;
}

const GET_INFO = [0xb0, 0x01, 0x00, 0x00, 0x00];
const GET_PUBKEY = [0xb0, 0x10, 0x00, 0x00, 0x21];

/** The objects readCashuRegistry vouches for: a sweep that names one reads it first under SCP03. */
const CASHU_OBJECTS: readonly Bytes[] = [
  TAG_AID,
  CARD_AID,
  OPENER_AID,
  CASHU_PACKAGE_AID,
];

/** The card: the opener first, then the card's applet, then the tag under the NFC Forum's name (HARDWARE_DEPLOYMENT.md). */
export function cashuPlan(loadFile: LoadFileAsset): Plan {
  return {
    name: 'Cashu card',
    loadFile,
    packageAid: CASHU_PACKAGE_AID,
    installs: [
      {phase: 'installOpener', module: OPENER_AID, instance: OPENER_AID},
      {phase: 'installCard', module: CARD_AID, instance: CARD_AID},
      {phase: 'installTag', module: TAG_CLASS_AID, instance: TAG_AID},
    ],
    sweep: [TAG_AID, CARD_AID, OPENER_AID, CASHU_PACKAGE_AID],
    guard: CARD_AID,
    checks: [
      // the whole AID, never the package AID (D25): the tracked CAP's version, 02 02
      {apdu: selectAid(CARD_AID), data: [...CARD_VERSION]},
      {apdu: GET_INFO, length: 30},
      {apdu: GET_PUBKEY, length: 33},
      {apdu: selectAid(TAG_AID)},
    ],
  };
}

/** The smoke test: the hello package, one instance, HELLO to INS 01, then deleted again. */
export function helloPlan(loadFile: LoadFileAsset): Plan {
  return {
    name: 'hello applet',
    loadFile,
    packageAid: HELLO_PACKAGE_AID,
    installs: [{phase: 'installCard', module: HELLO_AID, instance: HELLO_AID}],
    sweep: [HELLO_AID, HELLO_PACKAGE_AID],
    checks: [
      {apdu: selectAid(HELLO_AID)},
      {
        apdu: [0x80, 0x01, 0x00, 0x00, 0x05],
        data: [0x48, 0x45, 0x4c, 0x4c, 0x4f],
      },
    ],
    removeAfterChecks: [HELLO_AID, HELLO_PACKAGE_AID],
  };
}

/** One APDU in a readout: its INS, the length of its data, the SW and the time. Never its bytes. */
export interface ApduRecord {
  phase: string;
  ins: number;
  lc: number;
  sw?: number;
  rlen?: number;
  ms: number;
}

export interface PhaseTiming {
  phase: string;
  ms: number;
  apdus: number;
  maxMs: number;
}

export type RunEvent =
  | {type: 'phase'; phase: string}
  /** Emitted only after the LOAD response confirms this block. */
  | {type: 'block'; index: number; of: number}
  | {type: 'apdu'; record: ApduRecord};

export interface RunOptions {
  random: Random;
  /** Milliseconds, any origin. */
  now: () => number;
  /** Called synchronously, never awaited; whatever it throws is ignored. */
  onEvent?: (event: RunEvent) => void;
  macOverModifiedApdu?: boolean;
  /**
   * The security domain a run selects, logs in to and loads into: the ISD's
   * AID by default (A000000151000000 on the J3R180 and the J3R452). SCP03's
   * card challenge is made over it, so a wrong one stops at WrongKeys, and an
   * SCP03 install reads the registry for it. resetOwnedCard takes the ISD
   * alone and stops guarded, before its first APDU, at any other: its
   * identity read (identity.ts) and its registry read select the ISD until
   * slice 2 (ENG-835) threads this through them.
   */
  sdAid?: Bytes;
}

export interface ProvisionOptions extends RunOptions {
  /** Remove an installed card applet whose GET_INFO is empty. Spare cards only. */
  replace?: boolean;
  /** The card manager's keys; the factory set by default. */
  keys?: KeySet;
}

export interface RunResult<P extends string> {
  ok: boolean;
  /** Where the run stopped: `done` when it finished. */
  phase: P;
  kind?: StopKind;
  sw?: number;
  ins?: number;
  reason?: string;
  timings: PhaseTiming[];
  apdus: ApduRecord[];
  freeBefore?: FreeMemory;
  freeAfter?: FreeMemory;
  /** The LOAD block last sent (1-based), of how many. */
  blocks?: {at: number; of: number};
}

export type ProvisionResult = RunResult<Phase>;

/** How a run ended, before the bookkeeping is added. */
interface Outcome {
  ok: boolean;
  kind?: StopKind;
  sw?: number;
  ins?: number;
  reason?: string;
}

export interface RotateResult extends RunResult<RotatePhase> {
  /** Confirmed active key version from the successful authentication. */
  keyVersion?: number;
  /** Which set the card proved. */
  active?: 'from' | 'to';
  /** False when the card was already on `to` (a PUT KEY whose reply was lost). */
  rotated?: boolean;
  /**
   * True when this run made first contact (D182): PUT KEY P1 00 moved an SCP03
   * card from SHIPPED_KVN to `to` at FACTORY_KVN, and the reopen proved it there.
   */
  firstContact?: boolean;
}

/** A refusal of this module's own, before the card is touched further. */
class Guard extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Guard';
  }
}

function expectOk(reply: Reply, ins: number): Reply {
  if (reply.sw !== 0x9000) {
    throw new CardError(reply.sw, ins);
  }
  return reply;
}

/** The bookkeeping of one run: the phase, the clock, the records, the events. */
class Run<P extends string> {
  phase: P;
  readonly records: ApduRecord[] = [];
  readonly timings: PhaseTiming[] = [];
  freeBefore?: FreeMemory;
  freeAfter?: FreeMemory;
  blocks?: {at: number; of: number};
  private phaseStart: number;

  constructor(
    private readonly tx: Transceiver,
    private readonly options: RunOptions,
    first: P,
  ) {
    this.phase = first;
    this.phaseStart = options.now();
  }

  emit(event: RunEvent): void {
    const onEvent = this.options.onEvent;
    if (!onEvent) {
      return;
    }
    try {
      const r = onEvent(event) as unknown;
      if (r && typeof (r as Promise<unknown>).then === 'function') {
        (r as Promise<unknown>).then(undefined, () => undefined);
      }
    } catch {
      // A readout that throws is the readout's problem, not the card's.
    }
  }

  enter(phase: P): void {
    this.closePhase();
    this.phase = phase;
    this.phaseStart = this.options.now();
    this.timings.push({phase, ms: 0, apdus: 0, maxMs: 0});
    this.emit({type: 'phase', phase});
  }

  private closePhase(): void {
    const t = this.timings[this.timings.length - 1];
    if (t && t.phase === this.phase) {
      t.ms = this.options.now() - this.phaseStart;
    }
  }

  /** Every APDU goes through here: timed, and recorded as INS, Lc, SW and lengths. */
  readonly timed: Transceiver = async apdu => {
    const record: ApduRecord = {
      phase: this.phase,
      ins: apdu[1],
      lc: apdu.length > 5 ? apdu[4] : 0,
      ms: 0,
    };
    const t0 = this.options.now();
    try {
      const reply = await this.tx(apdu);
      if (reply && reply.length >= 2) {
        record.sw = (reply[reply.length - 2] << 8) | reply[reply.length - 1];
        record.rlen = reply.length - 2;
      }
      return reply;
    } finally {
      record.ms = this.options.now() - t0;
      this.records.push(record);
      const t = this.timings[this.timings.length - 1];
      if (t) {
        t.apdus++;
        t.maxMs = Math.max(t.maxMs, record.ms);
      }
      this.emit({type: 'apdu', record: {...record}});
    }
  };

  plain(apdu: Bytes): Promise<Reply> {
    return transmit(this.timed, Array.from(apdu));
  }

  finish(outcome: Outcome): RunResult<P> {
    this.closePhase();
    return {
      ...outcome,
      phase: this.phase,
      timings: this.timings,
      apdus: this.records,
      freeBefore: this.freeBefore,
      freeAfter: this.freeAfter,
      blocks: this.blocks,
    };
  }

  /** The result for an error, or the error again when it is neither the card's nor a guard's. */
  fail(e: unknown): RunResult<P> {
    if (e instanceof Guard) {
      return this.finish({ok: false, kind: 'guarded', reason: e.message});
    }
    if (e instanceof TransportError) {
      return this.finish({ok: false, kind: 'pulled', reason: e.message});
    }
    if (e instanceof WrongKeys) {
      return this.finish({ok: false, kind: 'wrongKeys', reason: e.message});
    }
    if (e instanceof CardError) {
      return this.finish({
        ok: false,
        kind: 'refused',
        sw: e.sw,
        ins: e.ins,
        reason: e.message,
      });
    }
    throw e;
  }
}

/** Why GET_INFO's 30 bytes are not an empty card, or null when they are. */
export function notEmpty(info: Bytes): string | null {
  if (info.length < 30) {
    return `GET_INFO answered ${info.length} bytes, not 30`;
  }
  if (info[3] !== 0) {
    return `it holds ${info[3]} unspent pieces`;
  }
  if (info[4] !== 0) {
    return `it has ${info[4]} spent pieces not yet freed`;
  }
  if (info[16] !== 0) {
    return 'it has an owner';
  }
  if (info[7] !== 0) {
    return 'it has a PIN';
  }
  if (info[11] !== 0) {
    return 'it has a record';
  }
  return null;
}

function loadFileBytes(asset: LoadFileAsset): number[] {
  let file: number[];
  try {
    file = fromHex(asset.hex);
  } catch {
    throw new Guard(`the ${asset.name} load file is not hex: nothing was sent`);
  }
  const digest = toHex(sha256(Uint8Array.from(file)));
  if (file.length !== asset.size || digest !== asset.sha256.toUpperCase()) {
    throw new Guard(
      `the ${asset.name} load file is ${file.length} bytes, sha256 ${digest.slice(0, 8)}...; ` +
        `the build says ${asset.size} bytes, ${asset.sha256.slice(0, 8)}...: nothing was sent`,
    );
  }
  return file;
}

const INSTALL_PHASES: readonly Phase[] = [
  'installOpener',
  'installCard',
  'installTag',
];

/**
 * Whether a run of `plan` that stopped in `phase` may have left the applet its
 * probe guards on the card: that applet's INSTALL had gone out, and only its
 * reply may have been lost. The next run's probe then finds the applet, empty
 * (a run gets that far only past no applet or an empty one), and stops
 * `guarded` unless `replace` is on. Never true for a plan with no guard.
 */
export function mayLeaveGuardedApplet(plan: Plan, phase: string): boolean {
  const guard = plan.guard;
  if (!guard) {
    return false;
  }
  const step = plan.installs.find(s => equal(s.instance, guard));
  if (!step) {
    return false;
  }
  const at = PHASES.indexOf(phase as Phase);
  return at >= 0 && at >= PHASES.indexOf(step.phase);
}

/** A plan runs the probe only when it has a card applet to guard, and only the INSTALLs it lists. */
function applies(plan: Plan, phase: Phase): boolean {
  if (phase === 'probe') {
    return plan.guard !== undefined;
  }
  if (INSTALL_PHASES.includes(phase)) {
    return plan.installs.some(s => s.phase === phase);
  }
  return true;
}

/**
 * Installs `plan` on the card in the field. Returns how the run ended; throws
 * only for a fault of the caller's (a bug), never for anything the card does.
 */
export async function provision(
  tx: Transceiver,
  plan: Plan,
  options: ProvisionOptions,
): Promise<ProvisionResult> {
  const run = new Run<Phase>(tx, options, plan.guard ? 'probe' : 'selectIsd');
  const keys = options.keys ?? FACTORY_KEYS;
  const sdAid = options.sdAid ?? ISD_AID;
  const sessionOptions = {
    macOverModifiedApdu: options.macOverModifiedApdu,
    sdAid,
  };
  let session: SecureSession | null = null;
  let blocks: number[][] = [];
  const open = (): SecureSession => {
    if (!session) {
      throw new Error('no secure channel');
    }
    return session;
  };

  const install = async (phase: InstallPhase) => {
    const step = plan.installs.find(s => s.phase === phase)!;
    expectOk(
      await open().send(
        run.timed,
        installAndSelectable(plan.packageAid, step.module, step.instance),
      ),
      0xe6,
    );
  };

  const steps: Record<Phase, () => Promise<void>> = {
    probe: async () => {
      const guard = plan.guard!;
      const selected = await run.plain(selectAid(guard));
      if (selected.sw === 0x6a82) {
        return; // no card applet: nothing to guard
      }
      expectOk(selected, 0xa4);
      if (selected.data.length < 2 || selected.data[0] !== 0x02) {
        throw new Guard(
          `${toHex(guard)} answers ${toHex(selected.data)} ${swHex(selected.sw)}, not a 2.x card applet: the app will not remove it`,
        );
      }
      const info = expectOk(await run.plain(GET_INFO), 0x01);
      const why = notEmpty(info.data);
      if (why) {
        throw new Guard(
          `the card applet is installed and ${why}: the app never removes a card that holds anything`,
        );
      }
      if (!options.replace) {
        throw new Guard(
          'the card applet is installed: turn on Replace to remove it first (spare card only)',
        );
      }
    },
    selectIsd: async () => {
      expectOk(await run.plain(selectAid(sdAid)), 0xa4);
      const free = await run.plain(getFreeMemory());
      run.freeBefore =
        free.sw === 0x9000
          ? (parseFreeMemory(free.data) ?? undefined)
          : undefined;
    },
    auth: async () => {
      session = await openSession(
        run.timed,
        keys,
        options.random,
        sessionOptions,
      );
    },
    sweep: async () => {
      const channel = open();
      // SCP03 is the J3R452's, which ships with the seller's NDEF tag at the
      // tag's AID (scp03-07): before a Cashu AID is deleted, the registry must
      // show each Cashu object on the card as the package's. SCP02, the
      // J3R180's, sends what it always has. What the seller's tag becomes is
      // slice 2's (ENG-835).
      if (
        channel.scp === 3 &&
        plan.sweep.some(aid => CASHU_OBJECTS.some(o => equal(o, aid)))
      ) {
        try {
          await readCashuRegistry(c => channel.send(run.timed, c), sdAid);
        } catch (e) {
          if (e instanceof RegistryEvidenceError) {
            throw new Guard(
              `the card's registry does not show every Cashu AID as the card package's (a J3R452 ships with the seller's NDEF tag at ${toHex(TAG_AID)}): nothing was deleted`,
            );
          }
          throw e;
        }
      }
      for (const aid of plan.sweep) {
        const r = await channel.send(run.timed, deleteAid(aid));
        if (r.sw !== 0x9000 && r.sw !== 0x6a88) {
          throw new CardError(r.sw, 0xe4);
        }
      }
    },
    installForLoad: async () => {
      expectOk(
        await open().send(run.timed, installForLoad(plan.packageAid, sdAid)),
        0xe6,
      );
    },
    load: async () => {
      for (let i = 0; i < blocks.length; i++) {
        run.blocks = {at: i + 1, of: blocks.length};
        expectOk(await open().send(run.timed, blocks[i]), 0xe8);
        run.emit({type: 'block', index: i + 1, of: blocks.length});
      }
    },
    installOpener: () => install('installOpener'),
    installCard: () => install('installCard'),
    installTag: () => install('installTag'),
    verify: async () => {
      for (const check of plan.checks) {
        const r = expectOk(await run.plain(check.apdu), check.apdu[1]);
        if (check.data && !equal(r.data, check.data)) {
          throw new CardError(
            r.sw,
            check.apdu[1],
            `INS ${toHex([check.apdu[1]])} answered ${toHex(r.data)}, not ${toHex(check.data)}`,
          );
        }
        if (check.length !== undefined && r.data.length !== check.length) {
          throw new CardError(
            r.sw,
            check.apdu[1],
            `INS ${toHex([check.apdu[1]])} answered ${r.data.length} bytes, not ${check.length}`,
          );
        }
      }
      if (plan.removeAfterChecks) {
        expectOk(await run.plain(selectAid(sdAid)), 0xa4);
        const again = await openSession(
          run.timed,
          keys,
          options.random,
          sessionOptions,
        );
        for (const aid of plan.removeAfterChecks) {
          expectOk(await again.send(run.timed, deleteAid(aid)), 0xe4);
        }
      }
      expectOk(await run.plain(selectAid(sdAid)), 0xa4);
      const free = await run.plain(getFreeMemory());
      run.freeAfter =
        free.sw === 0x9000
          ? (parseFreeMemory(free.data) ?? undefined)
          : undefined;
    },
    done: async () => undefined,
  };

  try {
    // the bytes first: a file that is not the build's sends nothing at all
    blocks = splitLoad(loadFileBytes(plan.loadFile), plan.blockSize);
    for (const phase of PHASES) {
      if (applies(plan, phase)) {
        run.enter(phase);
        await steps[phase]();
      }
    }
    return run.finish({ok: true});
  } catch (e) {
    if (e instanceof RangeError && blocks.length === 0) {
      return run.fail(
        new Guard(
          `the ${plan.loadFile.name} load file cannot be sent: ${e.message}`,
        ),
      );
    }
    return run.fail(e);
  }
}

export interface RotateOptions extends RunOptions {
  /**
   * PUT KEY's P1 and the new set's version. By default the active set's
   * version for both (in place, as gp --lock does), except at first contact,
   * where they are 00 and FACTORY_KVN. P1 00 anywhere else stops guarded.
   */
  putKey?: {p1?: number; newKvn?: number};
}

/**
 * Moves the card manager from `from` to `to`. One INITIALIZE UPDATE, whose
 * card cryptogram is checked offline against both sets: a PUT KEY whose reply
 * was lost leaves the card on `to`, and that is found without a failed login.
 * EXTERNAL AUTHENTICATE goes out only for a set the card proved; then PUT KEY,
 * and a fresh secure channel under `to` to show the card took it.
 *
 * An SCP03 card at SHIPPED_KVN (FF, a J3R452 as it ships) gets first contact
 * (D182): PUT KEY with P1 00 puts `to` at FACTORY_KVN (01), the card drops
 * the FF set, and the reopen must prove `to` at 01. Any other card has its
 * set replaced in place, with the APDUs this sent before. Each of these stops
 * guarded with nothing sent after INITIALIZE UPDATE: `to` proved at FF (only
 * an in-place rotation of a shipped card puts it there, and the reset refuses
 * FF), FF under SCP02 (never measured), and P1 00 on any card but one at
 * first contact (it would add a set beside the one in place).
 */
export async function rotateKeys(
  tx: Transceiver,
  from: KeySet,
  to: KeySet,
  options: RotateOptions,
): Promise<RotateResult> {
  const run = new Run<RotatePhase>(tx, options, 'selectIsd');
  const sdAid = options.sdAid ?? ISD_AID;
  const sessionOptions = {
    macOverModifiedApdu: options.macOverModifiedApdu,
    sdAid,
  };
  try {
    run.enter('selectIsd');
    expectOk(await run.plain(selectAid(sdAid)), 0xa4);
    run.enter('auth');
    const hs = await initializeUpdate(run.timed, options.random, 0, sdAid);
    const kvn = hs.reply.kvn;
    // a J3R452 as it ships: our set goes in at 01 and its FF set goes (D182)
    const first = hs.reply.scp === 3 && kvn === SHIPPED_KVN;
    const fromKeys = sessionIfMatches(from, hs);
    const toKeys = fromKeys ? null : sessionIfMatches(to, hs);
    if (!fromKeys && !toKeys) {
      throw new WrongKeys(
        'the card proved neither key set; EXTERNAL AUTHENTICATE was not sent',
      );
    }
    if (toKeys) {
      if (kvn === SHIPPED_KVN) {
        throw new Guard(
          'the card proved the new key set at version FF, where only an in-place rotation of a shipped card puts it and a reset refuses it: EXTERNAL AUTHENTICATE was not sent',
        );
      }
      await externalAuthenticate(run.timed, toKeys, hs, sessionOptions);
      run.enter('done');
      return {
        ...run.finish({ok: true}),
        active: 'to',
        rotated: false,
        keyVersion: kvn,
      };
    }
    const p1 = options.putKey?.p1 ?? (first ? 0x00 : kvn);
    const newKvn = options.putKey?.newKvn ?? (first ? FACTORY_KVN : kvn);
    if (kvn === SHIPPED_KVN && !first) {
      throw new Guard(
        'the card is at key version FF under SCP02, where first contact was never measured: EXTERNAL AUTHENTICATE was not sent',
      );
    }
    if (p1 === 0x00 && !first) {
      throw new Guard(
        `PUT KEY with P1 00 would add a key set beside version ${toHex([kvn])}: EXTERNAL AUTHENTICATE was not sent`,
      );
    }
    const session = await externalAuthenticate(
      run.timed,
      fromKeys!,
      hs,
      sessionOptions,
    );
    run.enter('putKey');
    const command = putKeys(to, session, {p1, newKvn});
    expectOk(await session.send(run.timed, command), 0xd8);
    run.enter('reopen');
    expectOk(await run.plain(selectAid(sdAid)), 0xa4);
    const reopened = await openSession(
      run.timed,
      to,
      options.random,
      sessionOptions,
    );
    if (first && reopened.keyVersion !== FACTORY_KVN) {
      throw new Guard(
        `after first contact the card proved the new key set at version ${toHex([reopened.keyVersion ?? 0])}, not 01: it may hold a set beside it`,
      );
    }
    run.enter('done');
    return {
      ...run.finish({ok: true}),
      active: 'to',
      rotated: true,
      keyVersion: reopened.keyVersion,
      ...(first ? {firstContact: true} : {}),
    };
  } catch (e) {
    return run.fail(e);
  }
}

/** Confirm only this set, without PUT KEY or a fallback authentication. */
export async function confirmManagerKeys(
  tx: Transceiver,
  keys: KeySet,
  options: RunOptions,
): Promise<RotateResult> {
  const run = new Run<RotatePhase>(tx, options, 'selectIsd');
  const sdAid = options.sdAid ?? ISD_AID;
  try {
    run.enter('selectIsd');
    expectOk(await run.plain(selectAid(sdAid)), 0xa4);
    run.enter('auth');
    const session = await openSession(run.timed, keys, options.random, {
      macOverModifiedApdu: options.macOverModifiedApdu,
      sdAid,
    });
    run.enter('done');
    return {
      ...run.finish({ok: true}),
      active: 'to',
      rotated: false,
      keyVersion: session.keyVersion,
    };
  } catch (e) {
    return run.fail(e);
  }
}
