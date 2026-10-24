/**
 * The app's adapter to the versioned cardkit package. Firmware load files
 * remain generated, pinned app assets rather than part of the library API.
 */
import {CASHU_LOAD_FILE} from './assets/cashu';
import {HELLO_LOAD_FILE} from './assets/hello';
import {cashuPlan, helloPlan} from '@cashu-card/cardkit';

export * from '@cashu-card/cardkit';
// Holder PIN/settlement helpers are explicit: the ops reset runner does not
// import or bundle this mobile-only crypto dependency through the GP barrel.
export * from '@cashu-card/cardkit/cleanup';

export const CASHU_PLAN = cashuPlan(CASHU_LOAD_FILE);
export const HELLO_PLAN = helloPlan(HELLO_LOAD_FILE);
