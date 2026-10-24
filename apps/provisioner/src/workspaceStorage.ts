/** Retained operator workspaces in the original atomic journal key.
 * Schema 3 deliberately blocks older binaries rather than hiding their work.
 * Adapters bind once to an actor; late writes cannot target another operator.
 */
import type {JournalStorage} from './journal';
import {assertJournalScope} from './journal';
import {ProvisioningWorkflow} from './provisioningWorkflow';
import {OwnedResetWorkflow} from './ownedResetWorkflow';
export interface WorkspaceActor {
  service_origin: string;
  operator_id: number;
  key_env: 'factory' | 'issued';
}
interface Entry {
  actor: WorkspaceActor;
  workflow: string | null;
  reset: string | null;
}
interface Envelope {
  schema: 3;
  device_id: string;
  legacy_reset: string | null;
  legacy_workflow: string | null;
  workspaces: Entry[];
}
export interface WorkspaceDisks {
  storage: JournalStorage;
  resetStorage: JournalStorage;
}
const key = (actor: WorkspaceActor) =>
  JSON.stringify([actor.service_origin, actor.operator_id, actor.key_env]);
const actorOf = (scope: WorkspaceActor): WorkspaceActor => ({
  service_origin: scope.service_origin,
  operator_id: scope.operator_id,
  key_env: scope.key_env,
});
const check = (ok: unknown): void => {
  if (!ok) {
    throw new Error('Saved work requires reconciliation');
  }
};
function fields(value: object, expected: string[]) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check(Object.keys(value).sort().join(',') === expected.sort().join(','));
}
const readonly = (raw: string | null): JournalStorage => ({
  read: async () => raw,
  replace: async () => {
    throw new Error('Validation must not write');
  },
});
const empty = (deviceId: string) =>
  JSON.stringify({
    schema: 2,
    device_id: deviceId,
    batch: null,
    active: null,
    history: [],
  });

export class WorkspaceStorage {
  private tail: Promise<unknown> = Promise.resolve();
  private adapters = new Map<string, WorkspaceDisks>();
  constructor(
    private backing: JournalStorage,
    private legacyReset: JournalStorage,
    private uuid: () => string,
  ) {}
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const job = this.tail.then(run);
    this.tail = job.catch(() => undefined);
    return job;
  }
  private async validateEntry(entry: Entry, deviceId: string) {
    fields(entry, ['actor', 'workflow', 'reset']);
    fields(entry.actor, ['service_origin', 'operator_id', 'key_env']);
    assertJournalScope({...entry.actor, device_id: deviceId});
    for (const raw of [entry.workflow, entry.reset]) {
      check(raw === null || typeof raw === 'string');
    }
    if (entry.workflow !== null) {
      const w = (
        await ProvisioningWorkflow.open(readonly(entry.workflow))
      ).snapshot();
      check(w.device_id === deviceId);
      if (w.batch) {
        check(key(w.batch.scope) === key(entry.actor));
      }
    }
    if (entry.reset !== null) {
      const r = (
        await OwnedResetWorkflow.open(readonly(entry.reset))
      ).snapshot();
      check(
        r &&
          r.journal.device_id === deviceId &&
          key(r.journal) === key(entry.actor),
      );
    }
  }
  private async load(): Promise<Envelope> {
    const raw = await this.backing.read();
    const legacy = await this.legacyReset.read();
    if (raw !== null && JSON.parse(raw).schema === 3) {
      const envelope = JSON.parse(raw) as Envelope;
      fields(envelope, [
        'schema',
        'device_id',
        'legacy_workflow',
        'legacy_reset',
        'workspaces',
      ]);
      check(
        typeof envelope.device_id === 'string' &&
          Array.isArray(envelope.workspaces),
      );
      // Also validate a device with no populated workspaces.
      await ProvisioningWorkflow.open(readonly(empty(envelope.device_id)));
      check(envelope.legacy_reset === legacy);
      const originalReset = (
        await OwnedResetWorkflow.open(readonly(legacy))
      ).snapshot();
      check(
        !originalReset ||
          originalReset.journal.device_id === envelope.device_id,
      );
      check(
        envelope.legacy_workflow === null ||
          typeof envelope.legacy_workflow === 'string',
      );
      if (envelope.legacy_workflow !== null) {
        const original = (
          await ProvisioningWorkflow.open(readonly(envelope.legacy_workflow))
        ).snapshot();
        check(original.device_id === envelope.device_id);
      }
      const seen = new Set<string>();
      for (const entry of envelope.workspaces) {
        await this.validateEntry(entry, envelope.device_id);
        check(!seen.has(key(entry.actor)));
        seen.add(key(entry.actor));
      }
      return envelope;
    }
    // Validate BOTH legacy journals before a single migration write.
    const reset = (await OwnedResetWorkflow.open(readonly(legacy))).snapshot();
    const initial =
      raw === null ? empty(reset?.journal.device_id ?? this.uuid()) : raw;
    const workflow = (
      await ProvisioningWorkflow.open(readonly(initial))
    ).snapshot();
    const envelope: Envelope = {
      schema: 3,
      device_id: workflow.device_id,
      legacy_workflow: raw,
      legacy_reset: legacy,
      workspaces: [],
    };
    const retain = (actor: WorkspaceActor) => {
      let entry = envelope.workspaces.find(e => key(e.actor) === key(actor));
      if (!entry) {
        entry = {actor: actorOf(actor), workflow: null, reset: null};
        envelope.workspaces.push(entry);
      }
      return entry;
    };
    if (workflow.batch) {
      retain(workflow.batch.scope).workflow = initial;
    }
    if (reset) {
      retain(reset.journal).reset = legacy;
    }
    for (const entry of envelope.workspaces) {
      await this.validateEntry(entry, envelope.device_id);
    }
    await this.backing.replace(JSON.stringify(envelope));
    return envelope;
  }
  forActor(scope: WorkspaceActor): WorkspaceDisks {
    const actor = actorOf(scope),
      id = key(actor);
    const existing = this.adapters.get(id);
    if (existing) {
      return existing;
    }
    const disk = (field: 'workflow' | 'reset'): JournalStorage => ({
      read: () =>
        this.serial(async () => {
          const envelope = await this.load();
          return (
            envelope.workspaces.find(e => key(e.actor) === id)?.[field] ??
            (field === 'workflow' ? empty(envelope.device_id) : null)
          );
        }),
      replace: value =>
        this.serial(async () => {
          const envelope = await this.load();
          const previous = envelope.workspaces.find(e => key(e.actor) === id);
          const entry: Entry = {
            ...(previous ?? {actor, workflow: null, reset: null}),
            [field]: value,
          };
          await this.validateEntry(entry, envelope.device_id);
          if (previous) {
            envelope.workspaces[envelope.workspaces.indexOf(previous)] = entry;
          } else {
            envelope.workspaces.push(entry);
          }
          await this.backing.replace(JSON.stringify(envelope));
        }),
    });
    const adapters = {storage: disk('workflow'), resetStorage: disk('reset')};
    this.adapters.set(id, adapters);
    return adapters;
  }
}
