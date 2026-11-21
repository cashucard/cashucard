/**
 * The card maker's settings, maker/maker.json at the repository's root: the
 * one file that holds what is a maker's own (its name, its tag address, its
 * security domain and its design codes), so that the card's load file and
 * every tool carry none of it, and a maker's fork of this repository differs
 * from it in that file alone (maker/README.md). The rules are
 * maker/maker.schema.json's; tools/maker/maker.py checks the same file the
 * same way. This module reads no file: a caller hands it the parsed JSON.
 */
import {tagAddressProblem} from './tag';

export interface MakerSecurityDomain {
  /** Upper-case hex, 5 to 16 bytes. */
  aid: string;
  /** The public half of the maker's release key, upper-case hex, where the domain asks for DAP. */
  dapPublicKey?: string;
}

export interface MakerSettings {
  /** True only in the shared repository's neutral file: never written to a card in the field. */
  example: boolean;
  name: string;
  /** The NFC tag's address (tag.ts). */
  tagAddress: string;
  /** Null: the card manager's own domain. */
  securityDomain: MakerSecurityDomain | null;
  designCodes: string[];
}

/** A maker file that breaks a rule; the message names the field and the rule. */
export class MakerError extends Error {
  constructor(message: string) {
    super(`maker/maker.json: ${message}`);
    this.name = 'MakerError';
  }
}

const KEYS = [
  '$schema',
  'example',
  'name',
  'tagAddress',
  'securityDomain',
  'designCodes',
];

/** The settings in `value` (maker/maker.json, parsed), checked; throws MakerError naming what is wrong. */
export function parseMaker(value: unknown): MakerSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MakerError('not a JSON object');
  }
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!KEYS.includes(key)) {
      throw new MakerError(`unknown field ${JSON.stringify(key)}`);
    }
  }
  for (const key of KEYS.slice(1)) {
    if (!(key in v)) {
      throw new MakerError(`no ${key}`);
    }
  }
  if (typeof v.example !== 'boolean') {
    throw new MakerError('example is true or false');
  }
  if (
    typeof v.name !== 'string' ||
    v.name.trim().length === 0 ||
    v.name.length > 64
  ) {
    throw new MakerError('name is 1 to 64 characters');
  }
  const problem = tagAddressProblem(v.tagAddress as string);
  if (typeof v.tagAddress !== 'string' || problem) {
    throw new MakerError(`tagAddress: ${problem ?? 'not a string'}`);
  }
  let domain: MakerSecurityDomain | null = null;
  if (v.securityDomain !== null) {
    const d = v.securityDomain as Record<string, unknown>;
    if (typeof d !== 'object' || Array.isArray(d)) {
      throw new MakerError('securityDomain is null or an object');
    }
    for (const key of Object.keys(d)) {
      if (key !== 'aid' && key !== 'dapPublicKey') {
        throw new MakerError(
          `securityDomain: unknown field ${JSON.stringify(key)}`,
        );
      }
    }
    if (typeof d.aid !== 'string' || !/^([0-9A-F]{2}){5,16}$/.test(d.aid)) {
      throw new MakerError(
        'securityDomain.aid is 5 to 16 bytes of upper-case hex',
      );
    }
    if (
      d.dapPublicKey !== undefined &&
      (typeof d.dapPublicKey !== 'string' ||
        !/^([0-9A-F]{2})+$/.test(d.dapPublicKey))
    ) {
      throw new MakerError(
        'securityDomain.dapPublicKey is upper-case hex (the public key only)',
      );
    }
    domain = {
      aid: d.aid,
      ...(d.dapPublicKey === undefined
        ? {}
        : {dapPublicKey: d.dapPublicKey as string}),
    };
  }
  const codes = v.designCodes;
  if (
    !Array.isArray(codes) ||
    codes.some(c => typeof c !== 'string' || !/^[0-9A-Z]{3}$/.test(c)) ||
    new Set(codes).size !== codes.length
  ) {
    throw new MakerError(
      'designCodes is a list of distinct codes, three capital letters or digits each',
    );
  }
  return {
    example: v.example,
    name: v.name,
    tagAddress: v.tagAddress,
    securityDomain: domain,
    designCodes: [...(codes as string[])],
  };
}
