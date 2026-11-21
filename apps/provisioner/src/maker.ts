/**
 * The card maker's settings this build installs with: maker/maker.json at the
 * repository's root, the one file a maker's fork changes (maker/README.md).
 * Checked when the app starts, by cardkit's rules: a broken file fails the
 * build's tests and the app's first screen, never a tap.
 */
import raw from '../../../maker/maker.json';
import {parseMaker} from '@cashu-card/cardkit';

export const MAKER = parseMaker(raw);
