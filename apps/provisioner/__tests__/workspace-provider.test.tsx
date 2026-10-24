import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {AppStore, useApp} from '../src/store';
import {ApiClient} from '../src/api';
import {ProvisioningProvider, useProvisioning} from '../src/ProvisioningStore';
import {WorkspaceStorage} from '../src/workspaceStorage';
import type {CardProvisioningService} from '../src/provisioningWorkflow';
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('an old account’s late batch reply is retained only in its own workspace and cannot replace the new account’s screen', async () => {
  let bytes: string | null = null,
    ids = 0;
  const backing = {
    read: async () => bytes,
    replace: async (v: string) => {
      bytes = v;
    },
  };
  const workspaces = new WorkspaceStorage(
    backing,
    {read: async () => null, replace: async () => {}},
    () => uuid(++ids),
  );
  let app!: ReturnType<typeof useApp>,
    flow!: ReturnType<typeof useProvisioning>;
  let finish!: () => void;
  const services = new Map<number, CardProvisioningService>();
  const options = {
    workspaces,
    uuid: () => uuid(++ids),
    hardwareValidated: true,
    serviceFor: (session: {operator_id: number}) => {
      const scope = {
        service_origin: 'https://ops.test',
        operator_id: session.operator_id,
        key_env: 'issued' as const,
      };
      let service = services.get(session.operator_id);
      if (!service) {
        service = {
          scope,
          batch: jest.fn(async request => {
            if (scope.operator_id === 1) {
              await new Promise<void>(resolve => {
                finish = resolve;
              });
            }
            return {
              batch_id: scope.operator_id,
              batch_request_id: request.batch_request_id,
              operator_id: scope.operator_id,
              device_id: request.device_id,
              next_ordinal: 0,
              config: {
                ...request,
                key_env: 'issued',
                configuration_revision: 1,
              },
            };
          }),
        } as unknown as CardProvisioningService;
        services.set(scope.operator_id, service);
      }
      return service;
    },
  };
  function Probe() {
    app = useApp();
    flow = useProvisioning();
    return null;
  }
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <AppStore clientOptions={{baseUrl: 'https://ops.test'}}>
        <ProvisioningProvider options={options}>
          <Probe />
        </ProvisioningProvider>
      </AppStore>,
    );
  });
  const login = async (operator: number) => {
    const client = new ApiClient({baseUrl: 'https://ops.test'});
    jest
      .spyOn(client, 'operatorSession')
      .mockResolvedValue({
        operator_id: operator,
        env: 'issued',
        token: `token-${operator}`,
      });
    await act(async () => {
      await app.signIn('fixture', 'fixture', {client});
    });
  };
  try {
    const config = {
      count: 2,
      mint: 'https://mint.test',
      pinPolicy: 'perCard' as const,
      pinBatch: '',
      dailyUsd: 25,
      noPinUsd: 5,
    };
    await login(1);
    let old!: Promise<boolean>;
    await act(async () => {
      old = flow.create(config);
    });
    const device = flow.snapshot!.device_id;
    await act(async () => app.signOut());
    await login(2);
    expect(flow.snapshot!.batch).toBeNull();
    await act(async () => {
      expect(await flow.create(config)).toBe(true);
    });
    expect(flow.snapshot!.batch!.scope.operator_id).toBe(2);
    await act(async () => {
      finish();
      await old;
    });
    expect(flow.snapshot!.batch!.scope.operator_id).toBe(2);
    expect(flow.snapshot!.device_id).toBe(device);
    await act(async () => app.signOut());
    await login(1);
    expect(flow.snapshot!.batch).toMatchObject({
      batch_id: 1,
      scope: {operator_id: 1},
    });
    expect(services.get(1)!.batch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(bytes!).workspaces).toHaveLength(2);
  } finally {
    await act(async () => tree.unmount());
    jest.restoreAllMocks();
  }
});
