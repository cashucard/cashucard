/**
 * The one place the app reaches tools/cardkit (plain TypeScript, bundled by
 * Metro through `watchFolders`), and the load files make-assets.py writes.
 */
import {CASHU_LOAD_FILE} from './assets/cashu';
import {HELLO_LOAD_FILE} from './assets/hello';
import {cashuPlan, helloPlan} from '../../../tools/cardkit';

export * from '../../../tools/cardkit';

export const CASHU_PLAN = cashuPlan(CASHU_LOAD_FILE);
export const HELLO_PLAN = helloPlan(HELLO_LOAD_FILE);
