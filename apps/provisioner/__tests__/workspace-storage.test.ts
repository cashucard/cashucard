import {OwnedResetWorkflow} from '../src/ownedResetWorkflow';
import {WorkspaceStorage} from '../src/workspaceStorage';
import {ProvisioningWorkflow} from '../src/provisioningWorkflow';
import type {JournalStorage} from '../src/journal';
const id = '00000000-0000-4000-8000-000000000001';
const a = {
  service_origin: 'https://ops.test',
  operator_id: 1,
  key_env: 'issued' as const,
};
const b = {...a, operator_id: 2};
const empty = JSON.stringify({
  schema: 2,
  device_id: id,
  batch: null,
  active: null,
  history: [],
});
function disk(initial: string | null = null) {
  let raw = initial;
  return {
    read: jest.fn(async () => raw),
    replace: jest.fn(async (value: string) => {
      raw = value;
    }),
  };
}
async function pending(storage: JournalStorage, scope = a) {
  const w = await ProvisioningWorkflow.open(storage, () => id);
  await expect(
    w.start(
      {
        scope,
        batch: async () => {
          throw new Error('offline');
        },
      } as never,
      {
        count: 2,
        mint_url: 'https://mint.test',
        pin_policy: 'perCard',
        daily_usd: 25,
        no_pin_usd: 5,
        load_sha256: 'ab'.repeat(32),
      },
    ),
  ).rejects.toThrow('offline');
  return w.snapshot();
}
test('migrates the original request intact while another operator gets an independent batch', async () => {
  const original = disk(empty),
    legacyReset = disk();
  const before = await pending(original);
  const originalBytes = await original.read();
  const spaces = new WorkspaceStorage(original, legacyReset, () => {
    throw new Error('must keep device ID');
  });
  const other = spaces.forActor(b);
  const otherWork = await pending(other.storage, b);
  expect(otherWork.device_id).toBe(id);
  expect(JSON.parse((await spaces.forActor(a).storage.read())!)).toEqual(
    before,
  );
  expect(JSON.parse((await original.read())!).workspaces).toHaveLength(2);
  expect((await original.read())!).toContain(
    JSON.stringify(originalBytes).slice(1, -1),
  );
  expect(await spaces.forActor(a).storage.read()).toBe(originalBytes);
  expect(legacyReset.replace).not.toHaveBeenCalled();
  await expect(ProvisioningWorkflow.open(original)).rejects.toThrow(); // Downgrade fails closed.
});
test('service and key environment are part of workspace identity; adapter identities are stable', async () => {
  const spaces = new WorkspaceStorage(disk(empty), disk(), () => id);
  expect(spaces.forActor(a)).toBe(spaces.forActor({...a}));
  await pending(spaces.forActor(a).storage);
  for (const scope of [
    {...a, service_origin: 'https://other.test'},
    {...a, key_env: 'factory' as const},
  ]) {
    expect(
      JSON.parse((await spaces.forActor(scope).storage.read())!).batch,
    ).toBeNull();
  }
});
test('concurrent writes by different actors retain both original requests across process restart', async () => {
  const backing = disk(empty),
    reset = disk();
  const spaces = new WorkspaceStorage(backing, reset, () => id);
  await Promise.all([
    pending(spaces.forActor(a).storage),
    pending(spaces.forActor(b).storage, b),
  ]);
  const restarted = new WorkspaceStorage(backing, reset, () => id);
  expect(
    JSON.parse((await restarted.forActor(a).storage.read())!).batch.scope
      .operator_id,
  ).toBe(1);
  expect(
    JSON.parse((await restarted.forActor(b).storage.read())!).batch.scope
      .operator_id,
  ).toBe(2);
});
test('a scope-bound adapter refuses foreign evidence without changing disk', async () => {
  const backing = disk(empty),
    spaces = new WorkspaceStorage(backing, disk(), () => id);
  await pending(spaces.forActor(a).storage);
  const before = await backing.read();
  await expect(
    spaces
      .forActor(b)
      .storage.replace((await spaces.forActor(a).storage.read())!),
  ).rejects.toThrow();
  expect(await backing.read()).toBe(before);
});
test.each([
  '{',
  '{"schema":1}',
  JSON.stringify({...JSON.parse(empty), active: {}}),
])('unknown or malformed legacy data blocks without erasure: %s', async raw => {
  const backing = disk(raw),
    spaces = new WorkspaceStorage(backing, disk(), () => id);
  await expect(spaces.forActor(b).storage.read()).rejects.toThrow();
  expect(await backing.read()).toBe(raw);
  expect(backing.replace).not.toHaveBeenCalled();
});
test('a changed legacy reset and a failed write block rather than opening a fresh workspace', async () => {
  const backing = disk(empty),
    reset = disk(),
    spaces = new WorkspaceStorage(backing, reset, () => id);
  await spaces.forActor(a).storage.read();
  await reset.replace('{"unexpected":"legacy writer"}');
  await expect(spaces.forActor(b).storage.read()).rejects.toThrow();
  await reset.replace('null');
  const broken = disk(empty);
  broken.replace.mockRejectedValue(new Error('disk full'));
  await expect(
    new WorkspaceStorage(broken, disk(), () => id).forActor(b).storage.read(),
  ).rejects.toThrow('disk full');
  expect(await broken.read()).toBe(empty);
});

test('reset-only migration keeps the original review and consent with its operator, including when signed in as someone else', async () => {
  const legacy = disk();
  const workflow = await OwnedResetWorkflow.open(legacy);
  const review = {
    chipId: 'cplc-v1:4790d3213041093363205547',
    installationId:
      '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    unspent: 0,
    spent: 0,
    owner: true,
    pin: true,
    pinBlocked: false,
    tries: 3,
    locked: false,
    record: true,
    tag: true,
    sealed: true,
    mint: 'https://mint.test',
    recordDigest: 'ab'.repeat(32),
  };
  await workflow.begin(
    {
      scope: a,
      lookup: async () => ({
        can_reset: true,
        lookup: {
          status: 'found',
          source: {attemptId: id, keySourceRef: `escrow:${id}`},
        },
      }),
    } as never,
    id,
    id,
    review,
    {erase: true, valueHandled: true},
  );
  const original = await legacy.read();
  const backing = disk();
  const spaces = new WorkspaceStorage(backing, legacy, () => {
    throw new Error('reset has the device ID');
  });
  expect(await spaces.forActor(b).resetStorage.read()).toBeNull();
  expect(await spaces.forActor(a).resetStorage.read()).toBe(original);
  expect(JSON.parse((await spaces.forActor(b).storage.read())!).device_id).toBe(
    id,
  );
  const restarted = new WorkspaceStorage(backing, legacy, () => id);
  expect(
    (
      await OwnedResetWorkflow.open(restarted.forActor(a).resetStorage)
    ).snapshot(),
  ).toEqual(workflow.snapshot());
  const wrongDevice = disk(
    JSON.stringify({
      ...JSON.parse(empty),
      device_id: '00000000-0000-4000-8000-000000000002',
    }),
  );
  await expect(
    new WorkspaceStorage(wrongDevice, legacy, () => id)
      .forActor(b)
      .storage.read(),
  ).rejects.toThrow();
  expect(wrongDevice.replace).not.toHaveBeenCalled();
});

test('corruption in another workspace blocks the whole store without hiding it or overwriting it', async () => {
  const backing = disk(empty),
    legacy = disk(),
    spaces = new WorkspaceStorage(backing, legacy, () => id);
  await pending(spaces.forActor(a).storage);
  const envelope = JSON.parse((await backing.read())!);
  envelope.workspaces[0].workflow = '{}';
  const corrupted = JSON.stringify(envelope);
  await backing.replace(corrupted);
  await expect(spaces.forActor(b).storage.read()).rejects.toThrow();
  expect(await backing.read()).toBe(corrupted);
});
test('new writes preserve evidence when an atomic commit succeeds but its acknowledgement is lost', async () => {
  const backing = disk(empty),
    reset = disk();
  const original = backing.replace.getMockImplementation()!;
  backing.replace.mockImplementationOnce(async value => {
    await original(value);
    throw new Error('reply lost');
  });
  const spaces = new WorkspaceStorage(backing, reset, () => id);
  await expect(spaces.forActor(a).storage.read()).rejects.toThrow('reply lost');
  expect(JSON.parse((await backing.read())!).schema).toBe(3);
  await pending(spaces.forActor(a).storage);
  const before = await spaces.forActor(a).storage.read();
  expect(
    await new WorkspaceStorage(backing, reset, () => id)
      .forActor(a)
      .storage.read(),
  ).toBe(before);
});
