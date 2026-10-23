import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {AppStore} from '../src/store';
import {useProvisioning} from '../src/ProvisioningStore';
import {ProvisioningScreen} from '../src/screens/ProvisioningScreen';
import {SIGNIN} from '../src/strings';
jest.mock('../src/ProvisioningStore', () => ({useProvisioning: jest.fn()}));

test('a finished batch clearly separates installation from holder setup and can be closed', async () => {
  const close = jest.fn();
  jest.mocked(useProvisioning).mockReturnValue({
    status: 'ready',
    scopeMatches: true,
    busy: false,
    hardwareValidated: true,
    resetState: null,
    snapshot: {
      batch: {next_ordinal: 1, request: {count: 1}},
      active: null,
      history: [
        {
          stage: 'recorded',
          ordinal: 0,
          attempt_id: 'test-public-attempt',
          installation_id: '02' + '33'.repeat(32),
        },
      ],
    },
    close,
  } as unknown as ReturnType<typeof useProvisioning>);
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <AppStore>
        <ProvisioningScreen onSettings={() => {}} />
      </AppStore>,
    );
  });
  expect(tree.root.findByProps({testID: 'real-close'}).props.title).toBe(
    'CLOSE BATCH',
  );
  const text = tree.root
    .findAll(n => typeof n.props.children === 'string')
    .map(n => n.props.children)
    .join(' ');
  expect(text).toContain(
    'Installation saved. Set up this card in a holder wallet before loading or spending.',
  );
  expect(text).not.toMatch(
    /rotation records|acknowledged batch|not ready for holders/i,
  );
  await act(async () => {
    tree.root.findByProps({testID: 'real-close'}).props.onPress();
  });
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () => {
    tree.unmount();
  });
});
test('sign-in copy explains known failures and never displays an arbitrary error payload', () => {
  expect(SIGNIN.failed('bad-credentials')).toContain(
    'operator name and password',
  );
  expect(SIGNIN.failed('login-rate-limited')).toContain('Wait a minute');
  expect(SIGNIN.failed('private-password=canary')).not.toContain('canary');
});
