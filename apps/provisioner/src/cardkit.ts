/**
 * The one place the app reaches tools/cardkit (plain TypeScript, bundled by
 * Metro through `watchFolders`), and the load files make-assets.py writes.
 */
import {CASHU_LOAD_FILE} from './assets/cashu';
import {HELLO_LOAD_FILE} from './assets/hello';
import {cashuPlan, helloPlan} from '../../../tools/cardkit';

export * from '../../../tools/cardkit';
// Holder PIN/settlement helpers are explicit: the ops reset runner does not
// import or bundle this mobile-only crypto dependency through the GP barrel.
export * from '../../../tools/cardkit/gp/settled-cleanup';

export const CASHU_PLAN = cashuPlan(CASHU_LOAD_FILE);
export const HELLO_PLAN = helloPlan(HELLO_LOAD_FILE);
