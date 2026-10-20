/**
 * ops: the ENG-740 service (D29). Key issuance from a runtime-injected master
 * by HKDF-SHA256, escrowed at issuance in the same transaction, the card and
 * cap registries, the BTC anchor tip, operator sessions.
 */
export {OpsDb, MIGRATIONS} from './db';
export {
  deriveKeySet,
  newOrdinalSalt,
  INFO_ENC,
  INFO_MAC,
  INFO_DEK,
} from './keys';
export type {KeySet} from './keyset';
export {createBatch, getBatch, listBatches, BatchError} from './batches';
export {
  hashPassword,
  verifyPassword,
  createOperatorSession,
  createHolderSession,
  resolveSession,
  revokeSession,
  revokeSessionsForPrincipal,
  listSessionsForPrincipal,
  SESSION_TTL_SECONDS,
  defaultPwHash,
} from './auth';
export {NodePwHash, SubtlePwHash} from './pwhash';
export type {PasswordHasher, PwHashBackend} from './pwhash';
export {openSqliteFile} from './sqlite-file';
export {openSqlStorage, splitStatements} from './sql-do';
export type {SqlStorageLike} from './sql-do';
export type {SqlHandle, SqlStatement, SqlRunResult} from './sql';
export {
  AnchorFeed,
  HEADER_LEN,
  CACHE_SECONDS,
  httpTipFetcher,
  UpstreamError,
} from './anchor';
export type {TipFetcher, TipHeader, TipStore} from './anchor';
export {
  recordCard,
  getCard,
  listCards,
  addCapRelease,
  listCapReleases,
  RegistryError,
} from './registry';
export type {CardRow, CardInput, UpsertResult, CapReleaseRow} from './registry';
export {issueKeys, HolderIssueState} from './issue';
export type {IssueResult, IssueScope, IssuedKeysRow} from './issue';
export {route, HttpError} from './router';
export type {RouterDeps} from './router';
export {serve, DEFAULT_MINTS} from './server';
export {EnvMaster} from './master';
export {bootstrapOperator} from './bootstrap';
export type {MasterSource} from './master';
