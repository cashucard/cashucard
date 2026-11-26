/**
 * The provisioner's generated load files (tools/cardkit/make-assets.py), so
 * the tests run the real bytes: the card's 43,765-byte file from the tracked
 * CAP, and the hello applet's.
 */
export {CASHU_LOAD_FILE} from '../../../../apps/provisioner/src/assets/cashu';
export {HELLO_LOAD_FILE} from '../../../../apps/provisioner/src/assets/hello';
/** The tag address the tests install: example.com is kept for examples (RFC 2606); a card maker gives its own (maker/maker.json). */
export const TEST_TAG_ADDRESS = 'https://example.com/card';
