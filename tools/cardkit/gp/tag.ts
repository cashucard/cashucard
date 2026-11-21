/**
 * The NFC tag's address, which whoever installs the card gives the tag in its
 * install parameters (GlobalPlatform's C9): the card's package names none
 * (spec/APDU.md, "The NFC tag"; spec/vectors/tag-address.json). The rules are
 * the applet's own (applet/src/main/java/me/flashapp/cashu/Tag.java), checked
 * here first so that an install with a bad address stops before the card is
 * touched rather than at the tag's INSTALL.
 */

/** The address, whole, with https://: at most 127 bytes, so every length in the install command and the record is one byte. */
export const TAG_ADDRESS_MAX = 127;
const HTTPS = 'https://';
const BARRED = '"#<>\\^`{|}';

/** Why `address` cannot be a tag's address, or null when it can. */
export function tagAddressProblem(address: string): string | null {
  if (typeof address !== 'string' || address.length === 0) {
    return 'no tag address: the card maker gives one (maker/maker.json, tagAddress)';
  }
  if (!address.startsWith(HTTPS)) {
    return `the tag address ${JSON.stringify(address)} does not begin with https:// (in lowercase)`;
  }
  if (address.length === HTTPS.length) {
    return 'the tag address has nothing after https://';
  }
  if (address.length > TAG_ADDRESS_MAX) {
    return `the tag address is ${address.length} characters; the most is ${TAG_ADDRESS_MAX}, https:// included`;
  }
  if (!/[0-9A-Za-z]/.test(address[HTTPS.length])) {
    return 'the tag address must have a letter or a digit right after https://';
  }
  for (const ch of address) {
    const c = ch.codePointAt(0)!;
    if (c < 0x21 || c > 0x7e) {
      return `the tag address holds ${JSON.stringify(ch)}: only printable ASCII, no spaces`;
    }
    if (BARRED.includes(ch)) {
      return `the tag address holds ${JSON.stringify(ch)}, which may not stand in it (the card adds the # and its fragment)`;
    }
  }
  return null;
}

/** The address's bytes, after it is checked; throws a RangeError naming the problem. */
export function tagAddressBytes(address: string): number[] {
  const problem = tagAddressProblem(address);
  if (problem) {
    throw new RangeError(problem);
  }
  return Array.from(address, ch => ch.charCodeAt(0));
}

/** The tag's install parameters field: C9, the address's length, the address. */
export function tagInstallParameters(address: string): number[] {
  const bytes = tagAddressBytes(address);
  return [0xc9, bytes.length, ...bytes];
}

/**
 * The NDEF file (E104) of a card with no owner or no holder's record, as the
 * tag installed with `address` answers it: NLEN, then one short well-known URI
 * record, prefix code 04 ("https://"), the rest of the address, and "#new".
 */
export function tagNdefNew(address: string): number[] {
  const rest = tagAddressBytes(address).slice(HTTPS.length);
  const payload = [0x04, ...rest, ...Array.from('#new', c => c.charCodeAt(0))];
  const message = [0xd1, 0x01, payload.length, 0x55, ...payload];
  return [message.length >> 8, message.length & 0xff, ...message];
}
