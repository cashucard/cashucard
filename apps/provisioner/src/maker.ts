/**
 * The card maker: whoever makes these cards and publishes the address their
 * NFC tag opens. The person making cards sets the maker's name and tag address
 * in the app, once per ops service (D239). Nothing here is a default: the
 * shared repository's maker/maker.json is an example and pre-fills nothing; a
 * fork's own file pre-fills the Card maker form, and nothing installs until
 * the maker is saved on the phone.
 * The rules for the address are cardkit's (tagAddressProblem), the same ones
 * the applet keeps (D227). releaseGates.ts decides whether a card is installed.
 */
import raw from '../../../maker/maker.json';
import {parseMaker, tagAddressProblem} from '@cashu-card/cardkit';

/** maker/maker.json as this build carries it, checked when the app starts. */
export const MAKER_FILE = parseMaker(raw);

/** What the app keeps for one ops service. */
export interface MakerChoice {
  name: string;
  tagAddress: string;
}

/** The shared repository's example maker (maker/maker.json): never a maker's own. */
export const EXAMPLE_MAKER_NAME = 'Example card maker';
/** Names the internet keeps for examples (RFC 2606, RFC 6761): no card's holder is sent there. */
const EXAMPLE_HOSTS = /(^|\.)(example\.(com|net|org)|example|invalid|test|localhost)$/;

/** The host of a tag address that passed tagAddressProblem, in lowercase. */
function hostOf(address: string): string {
  const authority = address.slice('https://'.length).split(/[/?]/)[0];
  return authority
    .slice(authority.lastIndexOf('@') + 1)
    .replace(/:[0-9]*$/, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

/** Why `name` cannot be a maker's name, or null. The rule is maker/maker.schema.json's. */
export function makerNameProblem(name: unknown): string | null {
  if (typeof name !== 'string' || !/[^\s]/.test(name)) {
    return 'Enter the card maker’s name.';
  }
  if (name.length > 64) {
    return 'The maker name can be 64 characters at most.';
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return 'The maker name cannot hold line breaks or control characters.';
  }
  if (name.trim().toLowerCase() === EXAMPLE_MAKER_NAME.toLowerCase()) {
    return 'That is the example maker’s name. Enter your own.';
  }
  return null;
}

/** Why `tagAddress` cannot be this maker's tag address, or null. */
export function makerAddressProblem(tagAddress: unknown): string | null {
  if (typeof tagAddress !== 'string' || tagAddress.length === 0) {
    return 'Enter the tag address.';
  }
  const problem = tagAddressProblem(tagAddress);
  if (problem) {
    return `This tag address cannot be used: ${problem}.`;
  }
  // A phone decodes %78 in a host to x: no % there, so no example name hides.
  if (tagAddress.slice('https://'.length).split(/[/?]/)[0].includes('%')) {
    return 'This tag address cannot be used: the host name cannot hold %.';
  }
  if (EXAMPLE_HOSTS.test(hostOf(tagAddress))) {
    return 'That is an example address. Enter the address your cards open.';
  }
  return null;
}

/** Why this name and address cannot be installed with, or null when they can. */
export function makerProblem(name: unknown, tagAddress: unknown): string | null {
  return makerNameProblem(name) ?? makerAddressProblem(tagAddress);
}

/**
 * What a fork's maker file pre-fills in the Card maker form: its name and
 * address when the file is a maker's own and passes the rules, nothing for the
 * shared example. It opens no gate: only a maker saved on the phone does.
 */
export function makerFromFile(file: {
  example: boolean;
  name: string;
  tagAddress: string;
}): MakerChoice | null {
  return file.example || makerProblem(file.name, file.tagAddress)
    ? null
    : {name: file.name, tagAddress: file.tagAddress};
}

/**
 * What the phone answered for the ops service at `origin`: `read` when it is
 * that service's answer, undefined (not read yet) when it is another's. One
 * service's maker is never used for another.
 */
export function makerAnswerFor<T extends {origin: string}>(
  read: T | undefined,
  origin: string,
): T | undefined {
  return read?.origin === origin ? read : undefined;
}

/** One saved maker per ops service: the key ends with the service's origin. */
export const MAKER_KEY_PREFIX = 'cashu.provisioner.maker.v1:';
export interface MakerStorage {
  read(origin: string): Promise<string | null>;
  write(origin: string, value: string): Promise<void>;
}
const nativeStorage = () => {
  const module = require('@react-native-async-storage/async-storage');
  return module.default ?? module;
};
export const makerStorage: MakerStorage = {
  read: origin => nativeStorage().getItem(MAKER_KEY_PREFIX + origin),
  write: (origin, value) =>
    nativeStorage().setItem(MAKER_KEY_PREFIX + origin, value),
};

/**
 * The saved maker, or null when this service has none (every profile an
 * earlier build saved). Throws when the saved value cannot be read: the gate
 * then installs nothing, and never falls back to another address.
 */
export function decodeSavedMaker(saved: string | null): MakerChoice | null {
  if (saved === null) {
    return null;
  }
  const value = saved.length <= 4096 ? JSON.parse(saved) : null;
  if (
    !value ||
    Object.keys(value).sort().join(',') !== 'name,schema,tagAddress' ||
    value.schema !== 1 ||
    typeof value.name !== 'string' ||
    typeof value.tagAddress !== 'string'
  ) {
    throw new Error('The card maker setting could not be read.');
  }
  return {name: value.name, tagAddress: value.tagAddress};
}
export const encodeSavedMaker = (value: MakerChoice) =>
  JSON.stringify({schema: 1, name: value.name, tagAddress: value.tagAddress});
