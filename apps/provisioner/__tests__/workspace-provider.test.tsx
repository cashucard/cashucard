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

test('switching services with the same operator number restores only that service’s saved batch', async () => {
  let bytes: string | null = null, ids = 0;
  const workspaces = new WorkspaceStorage({read: async () => bytes, replace: async v => {bytes = v;}},
    {read: async () => null, replace: async () => {}}, () => uuid(++ids));
  const services = new Map<string, CardProvisioningService>();
  let app!: ReturnType<typeof useApp>, flow!: ReturnType<typeof useProvisioning>;
  function Probe() {app = useApp(); flow = useProvisioning(); return null;}
  let profile: string | null = null;
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {tree = Renderer.create(<AppStore clientOptions={{baseUrl: 'https://ops.test'}} serviceStorage={{read: async () => profile, write: async v => {profile = v;}}}>
    <ProvisioningProvider options={{workspaces, hardwareValidated: true, uuid: () => uuid(++ids),
      serviceFor: (session, origin) => {
        let service = services.get(origin);
        if (!service) {
          service = {scope: {service_origin: origin, operator_id: session.operator_id, key_env: session.env}, batch: jest.fn(async request => ({batch_id: origin === 'https://ops.test' ? 1 : 2,
            batch_request_id: request.batch_request_id, operator_id: session.operator_id, device_id: request.device_id, next_ordinal: 0,
            config: {...request, key_env: session.env, configuration_revision: 1}}))} as unknown as CardProvisioningService;
          services.set(origin, service);
        }
        return service;
      }}}><Probe /></ProvisioningProvider>
  </AppStore>);});
  const login = async () => {
    const client = new ApiClient({baseUrl: app.serviceUrl});
    jest.spyOn(client, 'operatorSession').mockResolvedValue({operator_id: 1, env: 'issued', token: `fixture-${app.serviceUrl}`});
    await act(async () => app.signIn('operator', 'fixture', {client}));
  };
  try {
    await login();
    await act(async () => {await flow.create({count: 1, mint: 'https://mint.test', pinPolicy: 'perCard', pinBatch: '', dailyUsd: 0, noPinUsd: 0});});
    const first = JSON.stringify(flow.snapshot);
    const deviceId = flow.snapshot?.device_id;
    await act(async () => app.signOut());
    await act(async () => app.selectService('https://issuer.example.com'));
    await login();
    expect(flow.snapshot?.batch).toBeNull();
    expect(flow.snapshot?.device_id).toBe(deviceId);
    await act(async () => {await flow.create({count: 2, mint: 'https://mint.test', pinPolicy: 'perCard', pinBatch: '', dailyUsd: 0, noPinUsd: 0});});
    expect(flow.snapshot?.batch?.batch_id).toBe(2);
    await act(async () => app.signOut());
    await act(async () => app.selectService('https://ops.test'));
    await login();
    expect(JSON.stringify(flow.snapshot)).toBe(first);
  } finally {await act(async () => tree.unmount()); jest.restoreAllMocks();}
});
