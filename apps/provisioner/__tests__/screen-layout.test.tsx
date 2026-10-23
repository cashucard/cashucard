import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import App from '../App';
import {CardIdentityScreen} from '../src/screens/CardIdentityScreen';
import {AppStore} from '../src/store';
import {Screen, styles} from '../src/ui';
import {LIGHT} from '../src/theme';

const trees: Renderer.ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => {
    trees.splice(0).forEach(t => t.unmount());
  });
});

test('the app root supplies native safe areas and shared screens consume them', async () => {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <App
        recovery={{
          storage: {read: async () => null, replace: async () => {}},
          uuid: () => '00000000-0000-4000-8000-000000000001',
        }}
      />,
    );
  });
  trees.push(tree);
  expect(tree.root.findAllByType(SafeAreaProvider)).toHaveLength(1);
  expect(tree.root.findAllByType(SafeAreaView)).toHaveLength(1);
  await act(async () => {
    tree.unmount();
  });
});

test('titles participate in header layout so Back has its own space', () => {
  const layout = styles(LIGHT);
  expect(layout.titleWrap).not.toMatchObject({position: 'absolute'});
  expect(layout.titleWrap).toMatchObject({flex: 1, minWidth: 0});
});

test('only a physical identity check displays the read-only hardware banner', async () => {
  function Probe() {
    return (
      <>
        <CardIdentityScreen onBack={() => {}} />
        <Screen title="Settings">{null}</Screen>
      </>
    );
  }
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <AppStore>
        <Probe />
      </AppStore>,
    );
  });
  trees.push(tree);
  const banners = tree.root
    .findAllByProps({testID: 'screen-mode-banner'})
    .filter(n => typeof n.type !== 'string')
    .map(n => n.props.children);
  expect(banners).toContain('PHYSICAL CARD — read-only');
  expect(banners).toEqual(['PHYSICAL CARD — read-only']);
  await act(async () => {
    tree.unmount();
  });
});
