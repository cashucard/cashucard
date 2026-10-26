import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import App from '../App';
import {ApiClient} from '../src/api';
import {DEFAULT_SERVICE_URL} from '../src/store';
import type {
  CardProvisioningService,
  RemoteBatch,
} from '../src/provisioningWorkflow';

let tree: Renderer.ReactTestRenderer;
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
});

test.each(['start-batch', 'create-batch-only'])(
  '%s takes two presses from Cards with a visible mint/count and no separate review page',
  async action => {
    let bytes: string | null = null,
      seq = 0,
      batch: RemoteBatch;
    const runCard = jest.fn(async () => 'interrupted' as const);
    const service = {
      scope: {
        service_origin: DEFAULT_SERVICE_URL,
        operator_id: 1,
        key_env: 'issued',
      },
      batch: jest.fn(
        async request =>
          (batch ??= {
            batch_id: 7,
            batch_request_id: request.batch_request_id,
            operator_id: 1,
            device_id: request.device_id,
            next_ordinal: 0,
            config: {...request, key_env: 'issued', configuration_revision: 1},
          }),
      ),
      reserve: jest.fn(async request => ({
        ...request,
        operator_id: 1,
        revision: 0,
        state: 'active',
        chip_id: null,
        completion_receipt: null,
      })),
    } as unknown as CardProvisioningService;
    jest
      .spyOn(ApiClient.prototype, 'operatorSession')
      .mockResolvedValue({
        operator_id: 1,
        env: 'issued',
        token: 'fixture-token',
      });
    jest
      .spyOn(ApiClient.prototype, 'mints')
      .mockResolvedValue(['https://mint.test']);
    await act(async () => {
      tree = Renderer.create(
        <App
          recovery={{
            storage: {
              read: async () => bytes,
              replace: async v => {
                bytes = v;
              },
            },
            resetStorage: {read: async () => null, replace: async () => {}},
            uuid: () =>
              `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
            hardwareValidated: true,
            serviceFor: () => service,
            runCard,
          }}
        />,
      );
    });
    await act(async () => {
      tree.root
        .findByProps({testID: 'sign-in-name'})
        .props.onChangeText('operator');
      tree.root
        .findByProps({testID: 'sign-in-password'})
        .props.onChangeText('fixture');
    });
    await act(async () =>
      tree.root.findByProps({testID: 'sign-in'}).props.onPress(),
    );
    // Press one, from the authenticated Cards home.
    await act(async () =>
      tree.root.findByProps({testID: 'home-new'}).props.onPress(),
    );
    expect(
      tree.root.findByProps({testID: 'batch-inline-review'}).props.children,
    ).toContain('1 card');
    expect(
      tree.root.findByProps({testID: 'batch-inline-review'}).props.children,
    ).toContain('https://mint.test');
    expect(service.batch).not.toHaveBeenCalled();
    expect(runCard).not.toHaveBeenCalled();
    // Press two either starts the first card or creates the batch for later.
    await act(async () =>
      tree.root.findByProps({testID: action}).props.onPress(),
    );
    expect(service.batch).toHaveBeenCalledTimes(1);
    expect(runCard).toHaveBeenCalledTimes(action === 'start-batch' ? 1 : 0);
    expect(service.reserve).toHaveBeenCalledTimes(
      action === 'start-batch' ? 1 : 0,
    );
    expect(
      tree.root.findAllByProps({testID: 'confirm-start-batch'}),
    ).toHaveLength(0);
    expect(tree.root.findByProps({testID: 'real-progress'})).toBeDefined();
  },
);
