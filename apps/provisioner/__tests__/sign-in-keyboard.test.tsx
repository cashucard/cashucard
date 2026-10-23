import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import {ApiClient} from '../src/api';
import {SignInScreen} from '../src/screens/SignInScreen';
import {AppStore} from '../src/store';

let tree: Renderer.ReactTestRenderer;
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
});

test.each(['ios', 'android'] as const)(
  'sign-in action stays outside the scrollable fields and uses %s keyboard handling',
  async os => {
    jest.replaceProperty(Platform, 'OS', os);
    await act(async () => {
      tree = Renderer.create(
        <AppStore>
          <SignInScreen />
        </AppStore>,
      );
    });
    const avoiding = tree.root.findByType(KeyboardAvoidingView);
    expect(avoiding.props.enabled).toBe(os === 'ios');
    expect(avoiding.props.behavior).toBe(os === 'ios' ? 'padding' : undefined);
    const scroll = avoiding.findByType(ScrollView);
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
    expect(scroll.findByProps({testID: 'sign-in-password'})).toBeTruthy();
    expect(scroll.findAllByProps({testID: 'sign-in'})).toHaveLength(0);
    expect(avoiding.findByProps({testID: 'sign-in'})).toBeTruthy();
  },
);

test('Go submits typed credentials and dismisses the keyboard while waiting for the service', async () => {
  let finish!: (value: {
    operator_id: number;
    env: 'issued';
    token: string;
  }) => void;
  const login = jest
    .spyOn(ApiClient.prototype, 'operatorSession')
    .mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  await act(async () => {
    tree = Renderer.create(
      <AppStore>
        <SignInScreen />
      </AppStore>,
    );
  });
  await act(async () => {
    tree.root
      .findByProps({testID: 'sign-in-name'})
      .props.onChangeText('operator');
    tree.root
      .findByProps({testID: 'sign-in-password'})
      .props.onChangeText('public-test-fixture');
  });
  let pending!: Promise<void>;
  await act(async () => {
    pending = tree.root
      .findByProps({testID: 'sign-in-password'})
      .props.onSubmitEditing();
  });
  expect(login).toHaveBeenCalledWith(
    'operator',
    'public-test-fixture',
    expect.objectContaining({aborted: false}),
  );
  expect(login).toHaveBeenCalledTimes(1);
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(tree.root.findByProps({testID: 'sign-in'}).props.disabled).toBe(true);
  await act(async () => {
    finish({operator_id: 1, env: 'issued', token: 'public-test-token'});
    await pending;
  });
});
