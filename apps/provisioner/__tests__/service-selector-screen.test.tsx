import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import {ApiClient} from '../src/api';
import {DEFAULT_SERVICE_URL} from '../src/store';
import {opsDashboardUrl} from '../src/LegalLinks';
import {SERVICE_PROFILES_KEY} from '../src/serviceProfiles';
import {useProvisioning} from '../src/ProvisioningStore';
jest.mock('../src/ProvisioningStore', () => ({
  ProvisioningProvider: ({children}: {children: React.ReactNode}) => children,
  useProvisioning: jest.fn(),
}));
let tree: Renderer.ReactTestRenderer;
beforeEach(async () => {
  await AsyncStorage.removeItem(SERVICE_PROFILES_KEY);
  jest.mocked(useProvisioning).mockReturnValue({
    status: 'ready',
    scopeMatches: true,
    busy: false,
    hardwareValidated: true,
    snapshot: {batch: null, active: null, history: []},
    resetState: null,
  } as unknown as ReturnType<typeof useProvisioning>);
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
});
test('service review sends no credentials and returning to sign-in clears the old credential fields', async () => {
  const auth = jest
    .spyOn(ApiClient.prototype, 'operatorSession')
    .mockImplementation(async function (this: ApiClient) {
      expect(this.options.baseUrl).toBe('https://issuer.example.com');
      return {operator_id: 1, env: 'issued', token: 'issuer-token'};
    });
  await act(async () => {
    tree = Renderer.create(<App />);
  });
  await act(async () => {
    tree.root
      .findByProps({testID: 'sign-in-name'})
      .props.onChangeText('old-account');
    tree.root
      .findByProps({testID: 'sign-in-password'})
      .props.onChangeText('old-fixture-password');
  });
  await act(async () =>
    tree.root.findByProps({testID: 'sign-in-service'}).props.onPress(),
  );
  await act(async () =>
    tree.root
      .findByProps({testID: 'service-origin'})
      .props.onChangeText('https://issuer.example.com'),
  );
  await act(async () =>
    tree.root.findByProps({testID: 'service-review'}).props.onPress(),
  );
  expect(
    tree.root.findByProps({testID: 'service-review-origin'}).props.children,
  ).toBe('https://issuer.example.com');
  expect(auth).not.toHaveBeenCalled();
  await act(async () =>
    tree.root.findByProps({testID: 'service-confirm'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'sign-in-name'}).props.value).toBe('');
  expect(tree.root.findByProps({testID: 'sign-in-password'}).props.value).toBe(
    '',
  );
  expect(
    tree.root.findByProps({testID: 'sign-in-service'}).props.accessibilityLabel,
  ).toContain('issuer.example.com');
  expect(auth).not.toHaveBeenCalled();
  await act(async () => {
    tree.root
      .findByProps({testID: 'sign-in-name'})
      .props.onChangeText('issuer-account');
    tree.root
      .findByProps({testID: 'sign-in-password'})
      .props.onChangeText('issuer-fixture-password');
  });
  await act(async () =>
    tree.root.findByProps({testID: 'sign-in'}).props.onPress(),
  );
  expect(auth).toHaveBeenCalledWith(
    'issuer-account',
    'issuer-fixture-password',
    expect.any(AbortSignal),
  );
  expect(tree.root.findByProps({testID: 'home-service'}).props.children).toBe(
    'https://issuer.example.com',
  );
});

test('canceling a service review preserves the current destination', async () => {
  await act(async () => {
    tree = Renderer.create(<App />);
  });
  await act(async () =>
    tree.root.findByProps({testID: 'sign-in-service'}).props.onPress(),
  );
  await act(async () =>
    tree.root
      .findByProps({testID: 'service-origin'})
      .props.onChangeText('https://issuer.example.com'),
  );
  await act(async () =>
    tree.root.findByProps({testID: 'service-review'}).props.onPress(),
  );
  await act(async () =>
    tree.root.findByProps({testID: 'service-keep'}).props.onPress(),
  );
  await act(async () =>
    tree.root.findByProps({testID: 'back'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'sign-in'})).toBeDefined();
  expect(await AsyncStorage.getItem(SERVICE_PROFILES_KEY)).toBeNull();
  expect(
    tree.root.findByProps({testID: 'sign-in-service'}).props.accessibilityLabel,
  ).toContain(opsDashboardUrl(DEFAULT_SERVICE_URL));
});
