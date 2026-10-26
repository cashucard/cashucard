/**
 * What a run measured, for the bench report (docs/reports/HARDWARE_TEST_REPORT_*):
 * the tap wait, the total against iOS's 60-second session, the critical path,
 * each phase, every APDU over Android's default 618 ms, and the free memory
 * before and after. Built from cardkit's records, which hold an APDU's INS,
 * lengths, SW and time and never its bytes: nothing of a PUT KEY, or of any
 * other command, leaves the phone.
 */
import type {RunResult} from './cardkit';
import type {SessionMeta, Stamps} from './session';

/** iOS ends an NFC session 60 s after it starts, tap wait included. */
export const IOS_SESSION_MS = 60000;
/** Android's IsoDep timeout before setTimeout. */
export const ANDROID_DEFAULT_TIMEOUT_MS = 618;

/** The phases a phone must get through with the card held still: login to the last INSTALL. */
const CRITICAL = new Set([
  'auth',
  'installForLoad',
  'load',
  'installOpener',
  'installCard',
  'installTag',
  'putKey',
  'reopen',
]);

export interface PhaseLine {
  phase: string;
  ms: number;
  apdus: number;
  maxMs: number;
}

export interface Readout {
  action: string;
  platform: string;
  os: string;
  ok: boolean;
  stoppedAt: string;
  kind?: string;
  sw?: string;
  ins?: string;
  reason?: string;
  tapWaitMs?: number;
  totalMs?: number;
  iosHeadroomMs?: number;
  criticalPathMs: number;
  sweepMs: number;
  verifyMs: number;
  phases: PhaseLine[];
  slowApdus: {phase: string; ins: string; ms: number}[];
  apduCount: number;
  freeBefore?: number;
  freeAfter?: number;
  freeDelta?: number;
  androidTimeoutMs?: number | null;
  maxTransceive?: number | null;
}

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

/** True when the app must stop until it is restarted: the card did not take the keys, or refused a login. */
export function locksOut(result: RunResult<string>): boolean {
  return (
    result.kind === 'wrongKeys' ||
    (result.kind === 'refused' && (result.ins === 0x50 || result.ins === 0x82))
  );
}

export function makeReadout(input: {
  action: string;
  results: RunResult<string>[];
  stamps: Stamps;
  meta: SessionMeta;
}): Readout {
  const {action, results, stamps, meta} = input;
  const last = results[results.length - 1];
  const prefix = (i: number, phase: string) =>
    results.length > 1 ? `${i + 1}.${phase}` : phase;
  const phases: PhaseLine[] = [];
  const slowApdus: Readout['slowApdus'] = [];
  let critical = 0;
  let sweep = 0;
  let verify = 0;
  let apduCount = 0;
  results.forEach((r, i) => {
    for (const t of r.timings) {
      phases.push({
        phase: prefix(i, t.phase),
        ms: t.ms,
        apdus: t.apdus,
        maxMs: t.maxMs,
      });
      if (CRITICAL.has(t.phase)) {
        critical += t.ms;
      } else if (t.phase === 'sweep') {
        sweep += t.ms;
      } else if (t.phase === 'verify') {
        verify += t.ms;
      }
    }
    for (const a of r.apdus) {
      apduCount++;
      if (a.ms > ANDROID_DEFAULT_TIMEOUT_MS) {
        slowApdus.push({phase: prefix(i, a.phase), ins: hex2(a.ins), ms: a.ms});
      }
    }
  });
  const totalMs =
    stamps.done !== undefined ? stamps.done - stamps.arm : undefined;
  const before = results[0].freeBefore?.nonVolatile;
  const after = last.freeAfter?.nonVolatile;
  return {
    action,
    platform: meta.platform,
    os: meta.os,
    ok: last.ok,
    stoppedAt: last.phase,
    kind: last.kind,
    sw: last.sw === undefined ? undefined : hex4(last.sw),
    ins: last.ins === undefined ? undefined : hex2(last.ins),
    reason: last.reason,
    tapWaitMs:
      stamps.connect !== undefined ? stamps.connect - stamps.arm : undefined,
    totalMs,
    iosHeadroomMs: totalMs !== undefined ? IOS_SESSION_MS - totalMs : undefined,
    criticalPathMs: critical,
    sweepMs: sweep,
    verifyMs: verify,
    phases,
    slowApdus,
    apduCount,
    freeBefore: before,
    freeAfter: after,
    freeDelta:
      before !== undefined && after !== undefined ? before - after : undefined,
    androidTimeoutMs: meta.androidTimeoutMs,
    maxTransceive: meta.maxTransceive,
  };
}

const ms = (v: number | undefined) => (v === undefined ? 'n/a' : `${v} ms`);

/** The readout as text, for the screen and for Share. */
export function formatReadout(r: Readout): string {
  const lines = [
    `${r.action} on ${r.platform} ${r.os}: ${
      r.ok
        ? 'done'
        : `stopped at ${r.stoppedAt} (${r.kind}${r.sw ? ` ${r.sw}` : ''}${
            r.ins ? ` to INS ${r.ins}` : ''
          })`
    }`,
  ];
  if (r.reason && !r.ok) {
    lines.push(`why: ${r.reason}`);
  }
  lines.push(
    `tap wait ${ms(r.tapWaitMs)}, arm to done ${ms(
      r.totalMs,
    )}, iOS headroom ${ms(r.iosHeadroomMs)}`,
    `critical path (login to the last INSTALL) ${r.criticalPathMs} ms; sweep ${r.sweepMs} ms; verify ${r.verifyMs} ms; ${r.apduCount} APDUs`,
  );
  if (r.androidTimeoutMs !== undefined || r.maxTransceive !== undefined) {
    lines.push(
      `Android timeout ${r.androidTimeoutMs ?? 'unknown'} ms, max transceive ${
        r.maxTransceive ?? 'unknown'
      } bytes`,
    );
  }
  lines.push(
    `free memory ${r.freeBefore ?? 'n/a'} before, ${
      r.freeAfter ?? 'n/a'
    } after${r.freeDelta !== undefined ? `, ${r.freeDelta} used` : ''}`,
    'phase: ms, APDUs, slowest APDU',
  );
  for (const p of r.phases) {
    lines.push(`  ${p.phase}: ${p.ms} ms, ${p.apdus}, ${p.maxMs} ms`);
  }
  lines.push(
    `APDUs over ${ANDROID_DEFAULT_TIMEOUT_MS} ms: ${r.slowApdus.length}`,
  );
  for (const a of r.slowApdus) {
    lines.push(`  ${a.phase} INS ${a.ins}: ${a.ms} ms`);
  }
  return lines.join('\n');
}
