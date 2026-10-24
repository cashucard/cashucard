import AsyncStorage from '@react-native-async-storage/async-storage';
import type {JournalStorage} from './journal';

import {WorkspaceStorage} from './workspaceStorage';
import {randomUuid} from './random';

/** Fixed atomic key: schema 3 retains all actor workspaces, migrating schema 2.
 * No clear-on-sign-out and no namespace that hides pre-upgrade evidence.
 * No tokens, PINs, manager keys or transcripts belong in this store.
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

export const workspaceStorage = new WorkspaceStorage(
  journalStorage,
  resetStorage,
  randomUuid,
);
