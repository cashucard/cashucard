import {RecoveryDrill} from '../src/recoveryDrills';
import {runProvisioningTap, runReservedAttempt} from '../src/provisioningTap';
import {
  ProvisioningWorkflow,
  type CardProvisioningService,
  type ReservedAttempt,
} from '../src/provisioningWorkflow';
import {ProvisioningJournal, type JournalStorage} from '../src/journal';
import {
  CASHU_PLAN,
  FACTORY_KEYS,
  SPIKE_KEYS,
  fromHex,
  toHex,
  provision,
  type RunOptions,
} from '../src/cardkit';
import {FakeCard} from '@cashu-card/cardkit/testing';
const key =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const chip = 'cplc-v1:4790d3213180072976207515';
const cplc = fromHex(
  '9F7F2A4790D32147000000000031800729762075150000000000000000048C2337323937360000000000000000',
);
const scope = {
  operator_id: 7,
  device_id: '11111111-1111-4111-8111-111111111111',
  service_origin: 'https://ops.test',
  key_env: 'issued' as const,
};
const identity = {
  attempt_id: '22222222-2222-4222-8222-222222222222',
  batch_id: 42,
  ordinal: 0,
  load_sha256: CASHU_PLAN.loadFile.sha256,
};
const options: RunOptions = {random: n => Array(n).fill(0x55), now: () => 123};
function fixture() {
  const card = new FakeCard();
  let saved: string | null = null;
  const flags = {failInstalled: false, losePut: false, failRecord: false};
  const storage: JournalStorage = {
    read: async () => saved,
    replace: async value => {
      if (flags.failInstalled && JSON.parse(value).stage === 'installed') {
        flags.failInstalled = false;
        throw new Error('disk unavailable');
      }
      if (flags.failRecord && JSON.parse(value).stage === 'record_pending') {
        flags.failRecord = false;
        throw new Error('disk unavailable');
      }
      saved = value;
    },
  };
  const log: number[][] = [];
  const tx = async (command: number[]) => {
    log.push(command.slice());
    if (command[1] === 0xca && command[2] === 0x9f) {
      return [...cplc, 0x90, 0];
    }
    const reply = await card.transceive(command);
    if (command[1] === 0x10 && reply.at(-2) === 0x90) {
      return [...fromHex(key), 0x90, 0];
    }
    if (command[1] === 0xd8 && flags.losePut) {
      flags.losePut = false;
      throw new Error('reply lost after PUT KEY');
    }
    return reply;
  };
  const open = () => ProvisioningJournal.open(storage, scope, identity);
  const bind = jest.fn(async (id: string) => {
    expect(id).toBe(chip);
  });
  const tap = async (j: ProvisioningJournal) =>
    runProvisioningTap(tx, j, SPIKE_KEYS, bind, {
      ...options,
      verifiedAt: () => 1700000000,
    });
  return {card, storage, flags, log, tx, open, bind, tap};
}
const destructive = (log: number[][]) =>
  log.filter(c => [0xe4, 0xe6, 0xe8, 0xd8].includes(c[1]));

test('a verified install whose journal commit was lost is adopted without DELETE/LOAD on restart', async () => {
  const f = fixture();
  const j = await f.open();
  f.flags.failInstalled = true;
  await expect(f.tap(j)).rejects.toThrow('disk unavailable');
  const recovered = await f.open();
  expect(recovered.snapshot().stage).toBe('install_intent');
  expect(recovered.snapshot().preinstall?.inspection).toBe('absent');
  f.card.reset();
  const at = f.log.length;
  expect(await f.tap(recovered)).toBe('record_pending');
  expect(destructive(f.log.slice(at)).map(c => c[1])).toEqual([0xd8]);
  expect(recovered.snapshot()).toMatchObject({
    stage: 'record_pending',
    installation_id: key,
    gp_key_version: 1,
  });
  expect(JSON.parse(recovered.snapshot().frozen_record!)).toMatchObject({
    gp_key_version: 1,
    verified_stage: 'rotated',
  });
  expect(f.card.failedAuths).toBe(0);
});

test('lost PUT KEY response and process restart recover the same assigned set with no reinstall or failed authentication', async () => {
  const f = fixture();
  f.flags.losePut = true;
  expect(await f.tap(await f.open())).toBe('interrupted');
  const recovered = await f.open();
  expect(recovered.snapshot().stage).toBe('rotation_intent');
  f.card.reset();
  const at = f.log.length;
  expect(await f.tap(recovered)).toBe('record_pending');
  expect(destructive(f.log.slice(at))).toEqual([]);
  expect(f.card.failedAuths).toBe(0);
  const frozen = recovered.snapshot().frozen_record;
  const noMore = f.log.length;
  expect(await f.tap(await f.open())).toBe('record_pending');
  expect(f.log.length).toBe(noMore); // Record replay requires no card commands.
  expect((await f.open()).snapshot().frozen_record).toBe(frozen);
});

test('a crash before replacement DELETE never adopts the untouched old installation', async () => {
  const f = fixture();
  expect(
    (await provision(f.tx, CASHU_PLAN, {...options, keys: FACTORY_KEYS})).ok,
  ).toBe(true);
  const j = await f.open();
  await j.bind(chip);
  await j.installIntent({installation_id: key, replacement_consent: true});
  f.card.reset();
  const at = f.log.length;
  expect(await f.tap(await f.open())).toBe('quarantined');
  expect(destructive(f.log.slice(at))).toEqual([]);
  expect(f.log.slice(at).some(c => [0x50, 0x82].includes(c[1]))).toBe(false);
  expect((await f.open()).snapshot().quarantine_reason).toBe(
    'unsafe-partial-install',
  );
});

test('wrong chip and failed binding prevent authentication and mutation', async () => {
  const wrong = fixture();
  const j = await wrong.open();
  await j.bind(chip.replace('7515', '7516'));
  expect(await wrong.tap(j)).toBe('quarantined');
  expect(wrong.log.map(c => c[1])).toEqual([0xa4, 0xca]);
  const denied = fixture();
  await expect(
    runProvisioningTap(
      denied.tx,
      await denied.open(),
      SPIKE_KEYS,
      async () => {
        throw new Error('binding unavailable');
      },
      {...options, verifiedAt: () => 1},
    ),
  ).rejects.toThrow('binding unavailable');
  expect(denied.log.map(c => c[1])).toEqual([0xa4, 0xca, 0xa4]);
});

test('wrong manager keys latch quarantine across restart without a failed authentication', async () => {
  const f = fixture();
  expect((await provision(f.tx, CASHU_PLAN, options)).ok).toBe(true);
  f.card.keys = {
    enc: Array.from(SPIKE_KEYS.enc),
    mac: Array.from(SPIKE_KEYS.mac),
    dek: Array.from(SPIKE_KEYS.dek),
  };
  const j = await f.open();
  await j.bind(chip);
  await j.installIntent({installation_id: null, replacement_consent: false});
  await j.installed(key, {complete: true});
  const at = f.log.length;
  expect(
    await runProvisioningTap(f.tx, j, FACTORY_KEYS, f.bind, {
      ...options,
      verifiedAt: () => 1,
    }),
  ).toBe('quarantined');
  expect(f.log.slice(at).filter(c => c[1] === 0x82)).toEqual([]);
  expect(destructive(f.log.slice(at))).toEqual([]);
  expect(f.card.failedAuths).toBe(0);
  const beforeRetry = f.log.length;
  expect(await f.tap(await f.open())).toBe('quarantined');
  expect(f.log.length).toBe(beforeRetry);
});

test('a durably rotated attempt confirms the assigned keys without PUT KEY after a lost record commit', async () => {
  const f = fixture();
  f.flags.failRecord = true;
  await expect(f.tap(await f.open())).rejects.toThrow('disk unavailable');
  expect((await f.open()).snapshot()).toMatchObject({
    stage: 'rotated',
    gp_key_version: 1,
  });
  f.card.reset();
  const at = f.log.length;
  expect(await f.tap(await f.open())).toBe('record_pending');
  expect(destructive(f.log.slice(at))).toEqual([]);
  expect(f.log.slice(at).filter(c => c[1] === 0x82)).toHaveLength(1);
  expect(f.card.failedAuths).toBe(0);
});

test('an existing card is directed to reset before binding or authentication, even with legacy replacement consent', async () => {
  const f = fixture();
  expect((await provision(f.tx, CASHU_PLAN, options)).ok).toBe(true);
  const at = f.log.length;
  const review = jest.fn();
  expect(
    await runProvisioningTap(f.tx, await f.open(), SPIKE_KEYS, f.bind, {
      ...options,
      verifiedAt: () => 1,
      onReplacementRequired: review,
    }),
  ).toBe('reset-required');
  expect(review).toHaveBeenCalledWith({chipId: chip, installationId: key});
  expect(
    await runProvisioningTap(f.tx, await f.open(), SPIKE_KEYS, f.bind, {
      ...options,
      verifiedAt: () => 1,
      replacementInstallationId: '03' + key.slice(2),
    }),
  ).toBe('reset-required');
  expect(destructive(f.log.slice(at))).toEqual([]);
  expect((await f.open()).snapshot().stage).toBe('reserved');
  f.card.setCardState({unspent: 1});
  expect(
    await runProvisioningTap(f.tx, await f.open(), SPIKE_KEYS, f.bind, {
      ...options,
      replacementInstallationId: key,
      verifiedAt: () => 1,
    }),
  ).toBe('reset-required');
  expect(f.bind).not.toHaveBeenCalled();
  expect((await f.open()).snapshot().chip_id).toBeUndefined();
  expect(destructive(f.log.slice(at))).toEqual([]);
  expect(f.log.slice(at).filter(c => c[1] === 0x82)).toEqual([]);
});

test('a saved installation key mismatch prevents authentication on a matching chip', async () => {
  const f = fixture();
  expect((await provision(f.tx, CASHU_PLAN, options)).ok).toBe(true);
  const j = await f.open();
  await j.bind(chip);
  await j.installIntent({installation_id: null, replacement_consent: false});
  await j.installed('03' + key.slice(2), {complete: true});
  const at = f.log.length;
  expect(await f.tap(j)).toBe('quarantined');
  expect(destructive(f.log.slice(at))).toEqual([]);
  expect(f.log.slice(at).filter(c => [0x50, 0x82].includes(c[1]))).toEqual([]);
});

test('the reserved flow prefetches keys, binds before authentication, then records the observed rotation version after NFC closes', async () => {
  const f = fixture();
  f.card.kvn = 0x22;
  let next = 1;
  const w = await ProvisioningWorkflow.open(
    f.storage,
    () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`,
  );
  const settings = {
    count: 1,
    mint_url: 'https://mint.test',
    pin_policy: 'perCard' as const,
    daily_usd: 25,
    no_pin_usd: 5,
    load_sha256: CASHU_PLAN.loadFile.sha256,
  };
  let batchRequest = '';
  let consumed = 0;
  let remote: ReservedAttempt;
  let inNfc = false;
  let fetched = false;
  const service: CardProvisioningService = {
    scope: {
      service_origin: scope.service_origin,
      operator_id: 7,
      key_env: 'issued',
    },
    batch: async request => {
      batchRequest ||= request.batch_request_id;
      return {
        batch_id: 42,
        batch_request_id: batchRequest,
        device_id: w.snapshot().device_id,
        operator_id: 7,
        next_ordinal: consumed,
        config: {...settings, key_env: 'issued', configuration_revision: 1},
      };
    },
    reserve: async request => {
      consumed = 1;
      remote = {
        ...request,
        operator_id: 7,
        revision: 0,
        state: 'active',
        chip_id: null,
        completion_receipt: null,
        disposition_receipt: null,
      };
      return {...remote};
    },
    attempt: async () => ({...remote}),
    keys: async () => {
      expect(inNfc).toBe(false);
      fetched = true;
      return {
        ...remote,
        enc: toHex(SPIKE_KEYS.enc).toLowerCase(),
        mac: toHex(SPIKE_KEYS.mac).toLowerCase(),
        dek: toHex(SPIKE_KEYS.dek).toLowerCase(),
      };
    },
    bind: async (_device, id, input) => {
      expect(inNfc).toBe(true);
      expect(f.card.insLog()).not.toContain(0x50);
      remote.chip_id = input.chip_id;
      remote.revision = 1;
      return {
        attempt_id: id,
        chip_id: input.chip_id,
        revision: 1,
        bound_at: 123,
      };
    },
    record: async (_device, id, revision, frozen) => {
      expect(inNfc).toBe(false);
      expect(revision).toBe(1);
      expect(JSON.parse(frozen)).toMatchObject({
        gp_key_version: 0x22,
        installation_id: key,
        verified_stage: 'rotated',
        verified_at: 1700000000,
      });
      const receipt = {
        attempt_id: id,
        installation_id: key,
        revision: 2,
        recorded_at: 1700000001,
        verified_stage: 'rotated' as const,
        ready_for_holder: false as const,
      };
      remote.state = 'recorded';
      remote.revision = 2;
      remote.completion_receipt = receipt;
      return receipt;
    },
    disposition: async () => {
      throw new Error('no disposition expected');
    },
  };
  await w.start(service, settings);
  await w.reserveNext(service);
  const record = jest.spyOn(service, 'record');
  const checkpoint = jest.fn(async (boundary: string) => {
    if (boundary === 'record-frozen-session-closed') {
      expect(inNfc).toBe(false);
      expect(w.snapshot().active!.journal!.stage).toBe('record_pending');
      expect(record).not.toHaveBeenCalled();
    }
  });
  const withCard = jest.fn(
    async (
      run: (
        tx: typeof f.tx,
      ) => Promise<import('../src/provisioningTap').TapOutcome>,
    ) => {
      expect(fetched).toBe(true);
      inNfc = true;
      try {
        return await run(f.tx);
      } finally {
        inNfc = false;
      }
    },
  );
  expect(
    await runReservedAttempt(w, service, {
      ...options,
      withCard,
      checkpoint,
      verifiedAt: () => 1700000000,
    }),
  ).toBe('recorded');
  expect(checkpoint).toHaveBeenCalledWith('record-frozen-session-closed');
  expect(withCard).toHaveBeenCalledTimes(1);
  expect(w.snapshot().active).toBeNull();
  expect(w.snapshot().history[0]).toMatchObject({
    gp_key_version: 0x22,
    stage: 'recorded',
  });
  expect(w.snapshot().batch!.next_ordinal).toBe(1);
  expect(f.card.failedAuths).toBe(0);
  expect(await f.storage.read()).not.toContain(
    toHex(SPIKE_KEYS.enc).toLowerCase(),
  );
});

test.each([
  ['install-intent-saved', 'install_intent', false, 0],
  ['installation-verified-before-save', 'install_intent', true, 0],
  ['installation-saved', 'installed', true, 0],
  ['rotation-intent-saved', 'rotation_intent', true, 0],
  ['rotation-verified-before-save', 'rotation_intent', true, 1],
  ['rotation-saved', 'rotated', true, 1],
] as const)(
  'the %s drill pauses against saved %s evidence, with no later commands after stop',
  async (boundary, stage, loaded, puts) => {
    const f = fixture();
    const journal = await f.open();
    let hit!: () => void;
    const paused = new Promise<void>(resolve => {
      hit = resolve;
    });
    const drill = new RecoveryDrill(state => {
      if (state.paused) {
        hit();
      }
    });
    drill.arm(boundary);
    const pending = runProvisioningTap(f.tx, journal, SPIKE_KEYS, f.bind, {
      ...options,
      verifiedAt: () => 1700000000,
      checkpoint: point => drill.checkpoint(point),
    });
    try {
      expect(
        await Promise.race([
          paused.then(() => true),
          pending.then(() => false),
        ]),
      ).toBe(true);
      expect(journal.snapshot().stage).toBe(stage);
      expect(JSON.parse((await f.storage.read())!).stage).toBe(stage);
      expect(f.log.some(c => c[1] === 0xe8)).toBe(loaded);
      expect(f.log.filter(c => c[1] === 0xd8)).toHaveLength(puts);
      const commands = f.log.length;
      drill.cancel();
      expect(await pending).toBe('interrupted');
      expect(f.log).toHaveLength(commands);
      expect(journal.snapshot().stage).toBe(stage);
    } finally {
      drill.cancel();
      await pending;
    }
  },
);
