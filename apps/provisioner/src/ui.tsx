/**
 * The small shared pieces of the designed screens. Built on the theme tokens
 * only (src/theme.ts); nothing here draws its own color.
 */
import React from 'react';
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {FONT, type Theme, useTheme} from './theme';
import GearSvg from './assets/gear.svg';
import {DEMO_BANNER} from './strings';
import {useApp} from './store';

export function Screen({
  title,
  onBack,
  headerRight,
  children,
}: {
  title?: string;
  onBack?: () => void;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTheme();
  const app = useApp();
  const s = styles(t);
  return (
    <SafeAreaView style={s.screen}>
      {app.demo ? (
        <View style={s.banner}>
          <Text style={s.bannerText}>{DEMO_BANNER}</Text>
        </View>
      ) : null}
      {title || onBack || headerRight ? (
        <View style={s.header}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={12} testID="back">
              <Text style={s.back}>‹ Back</Text>
            </Pressable>
          ) : null}
          {title ? (
            <View style={s.titleWrap} pointerEvents="box-none">
              <Text style={s.title}>{title}</Text>
            </View>
          ) : null}
          {headerRight ? <View style={s.headerRight}>{headerRight}</View> : null}
        </View>
      ) : null}
      <View style={s.body}>{children}</View>
    </SafeAreaView>
  );
}

export function Dim({children}: {children: React.ReactNode}) {
  const t = useTheme();
  return <Text style={{color: t.dim, fontFamily: FONT.regular}}>{children}</Text>;
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
  danger,
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const s = styles(t);
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[
        s.primary,
        danger && s.primaryDanger,
        disabled && s.primaryDisabled,
      ]}>
      <Text style={s.primaryText}>{title}</Text>
    </Pressable>
  );
}

/** The quiet action beside the loud one: bordered, never accent. */
export function SecondaryButton({
  title,
  onPress,
  disabled,
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const s = styles(t);
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[s.secondary, disabled && s.primaryDisabled]}>
      <Text style={s.secondaryText}>{title}</Text>
    </Pressable>
  );
}

export function GearButton({onPress, testID}: {onPress: () => void; testID?: string}) {
  const t = useTheme();
  const s = styles(t);
  return (
    <Pressable onPress={onPress} hitSlop={12} testID={testID} style={s.gear}>
      <Gear size={22} color={t.dim} />
    </Pressable>
  );
}

/** The gearbox: flash-mobile's gear.svg artwork (icons-redesign), tinted. */
function Gear({size, color}: {size: number; color: string}) {
  return <GearSvg width={size} height={size} style={{color}} />;
}

export function Row({
  label,
  value,
  onPress,
  testID,
  style,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  testID?: string;
  style?: object;
}) {
  const t = useTheme();
  const s = styles(t);
  const inner = (
    <View style={[s.row, style]}>
      <Text style={s.rowLabel}>{label}</Text>
      {value !== undefined ? <Text style={s.rowValue}>{value}</Text> : null}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} testID={testID}>
      {inner}
    </Pressable>
  ) : (
    inner
  );
}

/** Spread into styles that position absolutely. */
const ABS = {position: 'absolute' as const};

export const styles = (t: Theme) =>
  StyleSheet.create({
    screen: {flex: 1, backgroundColor: t.bg},
    banner: {
      backgroundColor: t.danger,
      paddingVertical: 4,
      alignItems: 'center',
    },
    bannerText: {
      color: '#fff',
      fontFamily: FONT.semibold,
      fontSize: 12,
      letterSpacing: 1,
    },
    header: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 48,
    },
    title: {
      color: t.ink,
      fontFamily: FONT.semibold,
      fontSize: 26,
      letterSpacing: 0.2,
      textAlign: 'center',
    },
    titleWrap: {
      ...ABS,
      left: 64,
      right: 64,
      alignItems: 'center',
    },
    back: {color: t.accent, fontFamily: FONT.medium, fontSize: 16},
    body: {flex: 1, paddingHorizontal: 16, gap: 12},
    primary: {
      backgroundColor: t.accent,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: 'center',
    },
    primaryDanger: {backgroundColor: t.danger},
    primaryDisabled: {opacity: 0.35},
    gear: {padding: 6},
    secondary: {
      borderColor: t.line,
      borderWidth: 1.5,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: 'center',
    },
    secondaryText: {color: t.ink, fontFamily: FONT.medium, fontSize: 16},
    primaryText: {
      color: '#fff',
      fontFamily: FONT.semibold,
      fontSize: 17,
      letterSpacing: 0.4,
    },
    row: {
      backgroundColor: t.card,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 14,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    rowLabel: {color: t.ink, fontFamily: FONT.medium, fontSize: 16},
    rowValue: {
      color: t.dim,
      fontFamily: FONT.tabular,
      fontSize: 15,
      fontVariant: ['tabular-nums'],
    },
  });
