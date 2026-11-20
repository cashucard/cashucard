/**
 * Whether a card applet owes change: a payment it made for itself left change
 * at the mint that is not back on the card yet. While the applet is installed
 * the change can still come home (the holder's wallet reads the opening with
 * GET_CHANGE, asks the mint for it and writes it back); once the applet is
 * deleted, the opening's secrets go with it and the change is lost. Every
 * reset and every "empty" test asks this first.
 */
import {CardError, type Reply} from './apdu';

/** GET_CHANGE, page 0: a count, then the openings (80 bytes each on 2.1 and 2.2). */
export const GET_CHANGE = [0xb0, 0x19, 0x00, 0x00, 0x00];
/** The openings one GET_CHANGE page holds, 2.1 and 2.2. */
const PAGE = 3;
/** One opening of a 2.1 or 2.2 card: the amount, the keyset, the date, the nonce and r. */
const OPENING = 80;

/** What a 3.0 card says in GET_INFO byte 29 to anyone: 1 while change is owed. */
export function changeOwedByte(info: ArrayLike<number>): boolean {
  return info.length >= 30 && info[29] !== 0;
}

/**
 * Whether the card applet SELECT and GET_INFO answered (`info`, its first two
 * bytes the version) owes change. A 3.0 card says it in GET_INFO byte 29. A
 * 2.1 or 2.2 card's byte 29 says something else, so it is asked GET_CHANGE
 * (`ask`, plain, with the card applet selected), whose count is the openings
 * owed. Any other version, or an answer that is not GET_CHANGE's, throws: a
 * caller that cannot tell must not go on as if nothing were owed. GET_CHANGE
 * takes no PIN and changes nothing a holder owns: the card answers it to any
 * reader, and lets go there of an opening whose piece it already holds.
 */
export async function readChangeOwed(
  ask: (apdu: number[]) => Promise<Reply>,
  info: ArrayLike<number>,
): Promise<boolean> {
  if (info.length < 30) {
    throw new CardError(0x9000, 0x01, 'GET_INFO was too short for a card');
  }
  const [major, minor] = [info[0]!, info[1]!];
  if (major === 3 && minor === 0) {
    return changeOwedByte(info);
  }
  if (major !== 2 || (minor !== 1 && minor !== 2)) {
    throw new CardError(
      0x9000,
      0x01,
      `a ${major}.${minor} card: this kit cannot tell whether it owes change`,
    );
  }
  const reply = await ask(GET_CHANGE);
  if (reply.sw !== 0x9000) {
    throw new CardError(reply.sw, 0x19);
  }
  const count = reply.data[0];
  if (
    count === undefined ||
    count > PAGE ||
    reply.data.length !== 1 + count * OPENING
  ) {
    throw new CardError(
      reply.sw,
      0x19,
      `GET_CHANGE answered ${reply.data.length} bytes, not a count and its openings`,
    );
  }
  return count > 0;
}
