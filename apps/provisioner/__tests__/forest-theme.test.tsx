import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {Appearance, StatusBar, StyleSheet, Text} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AppStore} from '../src/store';
import {PrimaryButton, Screen} from '../src/ui';

let tree: Renderer.ReactTestRenderer;
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
});

test.each(['light', 'dark'] as const)(
  'operator pages keep the forest background when the phone uses %s appearance',
  async mode => {
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue(mode);
    await act(async () => {
      tree = Renderer.create(
        <AppStore>
          <Screen title="Cards">{null}</Screen>
        </AppStore>,
      );
    });
    expect(
      StyleSheet.flatten(tree.root.findByType(SafeAreaView).props.style)
        .backgroundColor,
    ).toBe('#10271E');
    expect(tree.root.findByType(StatusBar).props.barStyle).toBe(
      'light-content',
    );
  },
);

function luminance(hex: string): number {
  const full =
    hex.length === 4
      ? '#' +
        hex
          .slice(1)
          .split('')
          .map(c => c + c)
          .join('')
      : hex;
  return [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
    const s = parseInt(full.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return (
      sum + weight * (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4)
    );
  }, 0);
}

test.each([false, true])(
  'filled buttons have readable labels (danger: %s)',
  async danger => {
    await act(async () => {
      tree = Renderer.create(
        <AppStore>
          <PrimaryButton
            title="Continue"
            testID="continue"
            danger={danger}
            onPress={() => {}}
          />
        </AppStore>,
      );
    });
    const button = tree.root
      .findAllByProps({testID: 'continue'})
      .find(n => n.props.accessibilityRole === 'button')!;
    const background = luminance(
      StyleSheet.flatten(button.props.style).backgroundColor,
    );
    const foreground = luminance(
      StyleSheet.flatten(button.findByType(Text).props.style).color,
    );
    const ratio =
      (Math.max(background, foreground) + 0.05) /
      (Math.min(background, foreground) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  },
);
