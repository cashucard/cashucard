/** Tagged GET STATUS evidence, held to the owner's gp-list.txt capture. */
import {
  CARD_AID,
  CASHU_PACKAGE_AID,
  ISD_AID,
  OPENER_AID,
  TAG_AID,
} from './aids';
import {bytes, toHex, type Bytes} from './bytes';
import {CardError, type Reply} from './scp02';

export type RegistryKind = 'applications' | 'load-files';
export interface RegistryEntry {
  aid: string;
  lifeCycle: number;
  privileges: number[] | null;
  loadFile: string | null;
  domain: string | null;
}
export interface CashuRegistry {
  tag: boolean;
  card: boolean;
  opener: boolean;
  package: boolean;
}
export class RegistryEvidenceError extends Error {
  constructor() {
    super(
      'the card registry did not provide unambiguous Cashu package evidence',
    );
  }
}
export function registryCommand(kind: RegistryKind, more = false): number[] {
  return [
    0x80,
    0xf2,
    kind === 'applications' ? 0x40 : 0x20,
    more ? 3 : 2,
    2,
    0x4f,
    0,
    0,
  ];
}
interface Tlv {
  tag: number;
  value: number[];
}
/** Bounded BER lengths, no indefinite form or truncated tail. No recursive decoding. */
function tlvs(data: Bytes): Tlv[] {
  const input = bytes(data);
  const out: Tlv[] = [];
  let at = 0;
  while (at < input.length) {
    let tag = input[at++]!;
    if ((tag & 0x1f) === 0x1f) {
      const second = input[at++];
      if (second === undefined || (second & 0x80) !== 0)
        throw new RegistryEvidenceError();
      tag = (tag << 8) | second;
    }
    let length = input[at++];
    if (length === undefined) throw new RegistryEvidenceError();
    if (length === 0x81) {
      length = input[at++];
      if (length === undefined || length < 128)
        throw new RegistryEvidenceError();
    } else if (length === 0x82) {
      const high = input[at++],
        low = input[at++];
      if (high === undefined || low === undefined || high === 0)
        throw new RegistryEvidenceError();
      length = (high << 8) | low;
    } else if (length >= 0x80) throw new RegistryEvidenceError();
    if (at + length > input.length) throw new RegistryEvidenceError();
    out.push({tag, value: input.slice(at, at + length)});
    at += length;
  }
  return out;
}
export function parseRegistryEntries(data: Bytes): RegistryEntry[] {
  const seen = new Set<string>();
  return tlvs(data).map(outer => {
    if (outer.tag !== 0xe3) throw new RegistryEvidenceError();
    const fields = tlvs(outer.value);
    const one = (tag: number, required = false): number[] | null => {
      const matches = fields.filter(f => f.tag === tag);
      if (matches.length > 1 || (required && matches.length !== 1))
        throw new RegistryEvidenceError();
      return matches[0]?.value ?? null;
    };
    const aid = (tag: number, required = false): string | null => {
      const value = one(tag, required);
      if (value !== null && (value.length < 5 || value.length > 16))
        throw new RegistryEvidenceError();
      return value === null ? null : toHex(value);
    };
    const id = aid(0x4f, true)!;
    const life = one(0x9f70, true)!;
    const privileges = one(0xc5);
    if (
      life.length !== 1 ||
      seen.has(id) ||
      (privileges !== null && (privileges.length < 1 || privileges.length > 3))
    )
      throw new RegistryEvidenceError();
    seen.add(id);
    return {
      aid: id,
      lifeCycle: life[0]!,
      privileges,
      loadFile: aid(0xc4),
      domain: aid(0xcc),
    };
  });
}
export async function readCashuRegistry(
  send: (command: number[]) => Promise<Reply>,
): Promise<CashuRegistry> {
  const read = async (kind: RegistryKind): Promise<RegistryEntry[]> => {
    const data: number[] = [];
    for (let page = 0; page < 16; page++) {
      const reply = await send(registryCommand(kind, page > 0));
      if (reply.sw === 0x6a88 && page === 0 && reply.data.length === 0)
        return [];
      if (reply.sw !== 0x9000 && reply.sw !== 0x6310)
        throw new CardError(reply.sw, 0xf2);
      if (
        data.length + reply.data.length > 65535 ||
        (reply.sw === 0x6310 && reply.data.length === 0)
      )
        throw new RegistryEvidenceError();
      data.push(...reply.data);
      if (reply.sw === 0x9000) return parseRegistryEntries(data);
    }
    throw new RegistryEvidenceError();
  };
  const applications = await read('applications');
  const packages = await read('load-files');
  const packageId = toHex(CASHU_PACKAGE_AID),
    domain = toHex(ISD_AID);
  const instances = [toHex(TAG_AID), toHex(CARD_AID), toHex(OPENER_AID)];
  for (const entry of applications) {
    if (instances.includes(entry.aid)) {
      if (
        entry.loadFile !== packageId ||
        entry.domain !== domain ||
        entry.lifeCycle !== 7 ||
        !entry.privileges ||
        entry.privileges.some(v => v !== 0)
      )
        throw new RegistryEvidenceError();
    } else if (entry.loadFile === packageId) throw new RegistryEvidenceError();
    if (entry.aid === packageId) throw new RegistryEvidenceError();
  }
  for (const entry of packages) {
    if (
      entry.aid === packageId &&
      (entry.domain !== domain ||
        entry.lifeCycle !== 1 ||
        entry.loadFile !== null ||
        (entry.privileges !== null && entry.privileges.some(v => v !== 0)))
    )
      throw new RegistryEvidenceError();
    if (instances.includes(entry.aid)) throw new RegistryEvidenceError();
  }
  const hasPackage = packages.some(e => e.aid === packageId);
  if (!hasPackage && applications.some(e => instances.includes(e.aid)))
    throw new RegistryEvidenceError();
  return {
    tag: applications.some(e => e.aid === instances[0]),
    card: applications.some(e => e.aid === instances[1]),
    opener: applications.some(e => e.aid === instances[2]),
    package: hasPackage,
  };
}
