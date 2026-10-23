import AsyncStorage from '@react-native-async-storage/async-storage';
import type {JournalStorage} from './journal';

/** One atomic value; no clear-on-sign-out, fallback store or per-account key.
 * A foreign pending scope must be inspected, never hidden by another key.
 * No tokens, PINs, manager keys or transcripts belong in this store.
 * The coordinator stores its schema 2 envelope here; the fixed key stays
 * stable so old evidence is rejected visibly rather than hidden.
 * The app coordinator must own one journal writer for this key.
 */
export const journalStorage: JournalStorage = {
  read: () => AsyncStorage.getItem('cashu.provisioning.attempt.v1'),
  replace: value =>
    AsyncStorage.setItem('cashu.provisioning.attempt.v1', value),
};

/** A separate, retained reset journal; sign-out never clears it. */
export const resetStorage: JournalStorage = {
  read: () => AsyncStorage.getItem('cashu.provisioning.reset.v1'),
  replace: value => AsyncStorage.setItem('cashu.provisioning.reset.v1', value),
};
