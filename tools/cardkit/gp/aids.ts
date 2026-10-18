/**
 * The application identifiers the provisioner names. The card's own come from
 * applet/build.xml (D19, D25); the hello applet's from
 * tools/cardkit/hello/me/flashapp/hello/Hello.java and the `hello-cap` target.
 */
import {fromHex} from './bytes';

/** The card manager (Issuer Security Domain) of a J3R180. Never deleted. */
export const ISD_AID = fromHex('A000000151000000');

/** The card's package: F0 then "CASHUCARD". */
export const CASHU_PACKAGE_AID = fromHex('F0434153485543415244');
/** The opener, instantiated first (docs/FOXY-CARD-HARDWARE.md). */
export const OPENER_AID = fromHex('F04341534855434152444D');
/** The card's applet, selected by its whole AID (D25). */
export const CARD_AID = fromHex('F043415348554341524401');
/** The NFC tag's class, listed last in the package. */
export const TAG_CLASS_AID = fromHex('F043415348554341524454');
/** The NFC tag's instance: the NFC Forum's NDEF Tag Application. */
export const TAG_AID = fromHex('D2760000850101');

/** The hello applet's package: F0 then "CASHHELLO". */
export const HELLO_PACKAGE_AID = fromHex('F04341534848454C4C4F');
/** The hello applet, instantiated under its own AID. */
export const HELLO_AID = fromHex('F04341534848454C4C4F01');

/**
 * Everything DELETE may name, and nothing else: the card's three instances and
 * its package, the hello instance and its package. The ISD is not on it.
 */
export const DELETABLE_AIDS: readonly (readonly number[])[] = [
  TAG_AID,
  CARD_AID,
  OPENER_AID,
  CASHU_PACKAGE_AID,
  HELLO_AID,
  HELLO_PACKAGE_AID,
];
