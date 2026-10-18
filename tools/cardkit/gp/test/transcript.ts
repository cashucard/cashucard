/**
 * GlobalPlatformPro's `-d` log, read back: the APDUs it sent and what came
 * back, and a replay of its secure channel through this module's Session, so
 * every byte gp sent under the MAC is checked against what this module sends.
 *
 * gp v25.10.20 logs through apdu4j's LoggingCardTerminal:
 *
 *     A>> T=1 (4+0008) 80500000 08 1122334455667788 00
 *     A<< (0028+2) (31ms) 00009363...  9000
 *
 * ("A%s>> %s (4+%04d) %s" with the header, then Lc, data and Le; "A%s<<
 * (%04d+2) (%s)" with the time, then data and SW).
 */
import {concat, toHex} from '../bytes';
import {
  Session,
  externalAuthenticateCommand,
  hostCryptogram,
  parseCommand,
  parseInitializeUpdate,
  parseReply,
  sessionIfMatches,
  type Handshake,
  type KeySet,
} from '../scp02';

export interface Exchange {
  command: number[];
  reply: number[] | null;
}

function hexRun(text: string): number[] {
  const out: number[] = [];
  for (const token of text.trim().split(/\s+/)) {
    if (!/^([0-9A-Fa-f]{2})+$/.test(token)) {
      break;
    }
    for (let i = 0; i < token.length; i += 2) {
      out.push(parseInt(token.slice(i, i + 2), 16));
    }
  }
  return out;
}

/** The exchanges of a gp -d log, in order. Lines that are not APDUs are skipped. */
export function parseGpLog(text: string): Exchange[] {
  const out: Exchange[] = [];
  for (const line of text.split(/\r?\n/)) {
    const sent = /^A(?:#\d+)?>>\s+\S+\s+\(4\+\d+\)\s+(.*)$/.exec(line.trim());
    if (sent) {
      out.push({command: hexRun(sent[1]), reply: null});
      continue;
    }
    const got = /^A(?:#\d+)?<<\s+\(\d+\+2\)\s+\([^)]*\)\s*(.*)$/.exec(
      line.trim(),
    );
    if (got && out.length > 0 && out[out.length - 1].reply === null) {
      out[out.length - 1].reply = hexRun(got[1]);
    }
  }
  return out;
}

/** A wrapped command as it was before wrapping: CLA without 04, the MAC and 8 off Lc, Le kept. */
export function unwrap(command: number[]): number[] {
  const c = parseCommand(command);
  const data = c.data.slice(0, -8);
  return concat(
    [c.cla & ~0x04, c.ins, c.p1, c.p2],
    data.length ? [data.length, ...data] : [],
    c.le === null ? [] : [c.le],
  );
}

export interface Replay {
  handshake: Handshake;
  session: Session;
  /** Every command gp sent under the MAC, unwrapped, in order. */
  commands: number[][];
  /** The replies to them, in the same order. */
  replies: (number[] | null)[];
}

/**
 * The first secure channel in `log`, opened with `keys` and replayed: the
 * card's cryptogram must prove the keys, this module's EXTERNAL AUTHENTICATE
 * must be gp's byte for byte, and so must every command gp wrapped after it,
 * re-wrapped by this module from its unwrapped form. Throws at the first
 * difference.
 */
export function replay(
  log: Exchange[],
  keys: KeySet,
  options: {macOverModifiedApdu?: boolean} = {},
): Replay {
  const iu = log.findIndex(e => e.command[1] === 0x50);
  if (iu < 0 || !log[iu].reply) {
    throw new Error('no INITIALIZE UPDATE and reply in the log');
  }
  const handshake: Handshake = {
    hostChallenge: log[iu].command.slice(5, 13),
    reply: parseInitializeUpdate(parseReply(log[iu].reply!)),
  };
  const keysProved = sessionIfMatches(keys, handshake);
  if (!keysProved) {
    throw new Error('the card cryptogram in the log does not prove these keys');
  }
  const session = new Session(keysProved, options);
  const ea = log[iu + 1];
  if (!ea || ea.command[1] !== 0x82) {
    throw new Error(
      'INITIALIZE UPDATE is not followed by EXTERNAL AUTHENTICATE',
    );
  }
  const cryptogram = hostCryptogram(
    keysProved.enc,
    handshake.reply.seq,
    handshake.reply.cardChallenge,
    handshake.hostChallenge,
  );
  const ours = session.wrap(externalAuthenticateCommand(cryptogram));
  if (toHex(ours) !== toHex(ea.command)) {
    throw new Error(
      `EXTERNAL AUTHENTICATE differs:\n  gp   ${toHex(ea.command)}\n  ours ${toHex(ours)}`,
    );
  }
  const commands: number[][] = [];
  const replies: (number[] | null)[] = [];
  for (const e of log.slice(iu + 2)) {
    if (
      e.command[1] === 0xa4 ||
      e.command[1] === 0x50 ||
      (e.command[0] & 0x04) === 0
    ) {
      break; // the session ends at a SELECT, a new handshake or a command without its MAC
    }
    const original = unwrap(e.command);
    const again = session.wrap(original);
    if (toHex(again) !== toHex(e.command)) {
      throw new Error(
        `a wrapped command differs:\n  gp   ${toHex(e.command)}\n  ours ${toHex(again)}`,
      );
    }
    commands.push(original);
    replies.push(e.reply);
  }
  return {handshake, session, commands, replies};
}

/** One key in a key information template. */
export interface KeyInformation {
  id: number;
  kvn: number;
  /** Type and length of each of the key's components (one for a DES3 key). */
  components: {type: number; length: number}[];
}

/** A BER-TLV of `data` at `at`: tag (one byte), length (one byte, or 81 and one), value. */
function tlv(
  data: number[],
  at: number,
): {tag: number; value: number[]; end: number} {
  const tag = data[at];
  let length = data[at + 1];
  let start = at + 2;
  if (length === 0x81) {
    length = data[at + 2];
    start = at + 3;
  }
  if (
    tag === undefined ||
    length === undefined ||
    start + length > data.length
  ) {
    throw new Error(`a TLV at ${at} that runs past the data`);
  }
  return {tag, value: data.slice(start, start + length), end: start + length};
}

/**
 * GET DATA 00E0, the key information template, as gp -i reads it
 * (GPKeyInfo.parseTemplate): E0, then for each key C0 with the key ID, the
 * key set version and each component's type and length. The extended form
 * (FF in place of a type) is refused, not guessed at.
 */
export function parseKeyInformation(data: number[]): KeyInformation[] {
  const template = tlv(data, 0);
  if (template.tag !== 0xe0 || template.end !== data.length) {
    throw new Error(`not a key information template: ${toHex(data)}`);
  }
  const keys: KeyInformation[] = [];
  for (let at = 0; at < template.value.length;) {
    const entry = tlv(template.value, at);
    at = entry.end;
    const v = entry.value;
    if (entry.tag !== 0xc0 || v.length < 4 || v.length % 2 !== 0) {
      throw new Error(`not a key information entry: ${toHex(v)}`);
    }
    if (v[2] === 0xff) {
      throw new Error('extended key information is not read here');
    }
    const components: KeyInformation['components'] = [];
    for (let i = 2; i < v.length; i += 2) {
      components.push({type: v[i], length: v[i + 1]});
    }
    keys.push({id: v[0], kvn: v[1], components});
  }
  return keys;
}

/** One exchange as gp logs it. */
export function formatGpExchange(
  command: number[],
  reply: number[],
  ms = 12,
): string {
  const head = toHex(command.slice(0, 4));
  let rest = '';
  let nc = 0;
  if (command.length > 5) {
    nc = command[4];
    rest = ` ${toHex([command[4]])} ${toHex(command.slice(5, 5 + nc))}`;
    if (command.length > 5 + nc) {
      rest += ` ${toHex(command.slice(5 + nc))}`;
    }
  } else if (command.length === 5) {
    rest = ` ${toHex([command[4]])}`;
  }
  const data = reply.slice(0, -2);
  return [
    `A>> T=1 (4+${String(nc).padStart(4, '0')}) ${head}${rest}`,
    `A<< (${String(data.length).padStart(4, '0')}+2) (${ms}ms)${data.length ? ' ' + toHex(data) : ''} ${toHex(reply.slice(-2))}`,
  ].join('\n');
}
