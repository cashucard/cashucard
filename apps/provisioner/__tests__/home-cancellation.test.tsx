import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {ApiClient} from '../src/api';
import {AppStore, useApp} from '../src/store';
import {ProvisioningProvider, useProvisioning} from '../src/ProvisioningStore';
import {CardsHomeScreen} from '../src/screens/CardsHomeScreen';
import type {CardProvisioningService} from '../src/provisioningWorkflow';

test('Home Stop cancels the owned wait and retains a pending batch closure for retry', async () => {
  let bytes: string | null = null,
    ids = 0;
  const storage = {
    read: async () => bytes,
    replace: async (v: string) => {
      bytes = v;
    },
  };
  const uuid = () =>
    `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
  let failReply!: () => void;
  const service = {
    scope: {
      service_origin: 'https://ops.test',
      operator_id: 1,
      key_env: 'issued',
    },
    batch: jest.fn(async request => ({
      batch_id: 1,
      batch_request_id: request.batch_request_id,
      operator_id: 1,
      device_id: request.device_id,
      next_ordinal: 0,
      config: {...request, key_env: 'issued', configuration_revision: 1},
    })),
    endBatch: jest.fn(
      () =>
        new Promise((_resolve, reject) => {
          failReply = () => reject(new Error('response lost'));
        }),
    ),
  } as unknown as CardProvisioningService;
  let app!: ReturnType<typeof useApp>,
    flow!: ReturnType<typeof useProvisioning>;
  function Probe() {
    app = useApp();
    flow = useProvisioning();
    return app.session ? (
      <CardsHomeScreen
        onInstall={() => {}}
        onReset={() => {}}
        onSettings={() => {}}
      />
    ) : null;
  }
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <AppStore clientOptions={{baseUrl: 'https://ops.test'}}>
        <ProvisioningProvider
          options={{
            storage,
            resetStorage: {read: async () => null, replace: async () => {}},
            uuid,
            hardwareValidated: true,
            serviceFor: () => service,
          }}>
          <Probe />
        </ProvisioningProvider>
      </AppStore>,
    );
  });
  const client = new ApiClient({baseUrl: 'https://ops.test'});
  jest
    .spyOn(client, 'operatorSession')
    .mockResolvedValue({operator_id: 1, env: 'issued', token: 'fixture'});
  try {
    await act(async () => {
      await app.signIn('fixture', 'fixture', {client});
    });
    await act(async () => {
      await flow.create({
        count: 2,
        mint: 'https://mint.test',
        pinPolicy: 'perCard',
        pinBatch: '',
        dailyUsd: 25,
        noPinUsd: 5,
      });
    });
    const before = flow.snapshot!.batch!.request;
    await act(async () =>
      tree.root.findByProps({testID: 'home-end'}).props.onPress(),
    );
    let ending!: Promise<boolean>;
    const originalEnd = flow.end;
    flow.end = () => (ending = originalEnd());
    await act(async () =>
      tree.root.findByProps({testID: 'home-end-confirm'}).props.onPress(),
    );
    expect(flow.busy).toBe(true);
    expect(JSON.parse(bytes!).batch.ending).toBe(true);
    await act(async () =>
      tree.root.findByProps({testID: 'screen-stop'}).props.onPress(),
    );
    await act(async () => {
      failReply();
      await ending;
    });
    expect(flow.busy).toBe(false);
    expect(flow.notice).toContain('Stopped.');
    expect(flow.snapshot!.batch!.request).toEqual(before);
    expect(flow.snapshot!.batch!.ending).toBe(true);
    expect(JSON.parse(bytes!).batch.request).toEqual(before);
    expect(service.endBatch).toHaveBeenCalledTimes(1);
    expect(
      tree.root.findByProps({testID: 'home-end-retry'}).props.disabled,
    ).toBe(false);
  } finally {
    await act(async () => tree.unmount());
    jest.restoreAllMocks();
  }
});
