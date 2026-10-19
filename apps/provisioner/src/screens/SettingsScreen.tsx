/**
 * S5. Settings: the key environment (factory/test vs issued — the loop's
 * header always shows which a batch is on), the theme, the About rows, the
 * demo switch, and the bench's way into the load-test screen.
 */
import React from 'react';
import {ScrollView, StyleSheet, Switch, Text, View} from 'react-native';

import {SETTINGS} from '../strings';
import {useApp} from '../store';
import {FONT, useTheme, type Theme} from '../theme';
import {Dim, Row, Screen} from '../ui';

const local = (t: Theme) =>
  StyleSheet.create({
    scroll: {gap: 12, paddingBottom: 24},
    themeRow: {flexDirection: 'row', gap: 8},
    themeCell: {flex: 1},
    switchCard: {
      backgroundColor: t.card,
      borderRadius: 12,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    switchLabel: {
      flex: 1,
      color: t.ink,
      fontFamily: FONT.medium,
      fontSize: 16,
    },
  });

export function SettingsScreen({
  onBack,
  onBench,
}: {
  onBack: () => void;
  onBench: () => void;
}) {
  const app = useApp();
  const t = useTheme();
  const s = local(t);
  return (
    <Screen title={SETTINGS.title} onBack={onBack}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Dim>{SETTINGS.keyEnv}</Dim>
        <Row label={SETTINGS.factory} value={'●'} />
        <Dim>{SETTINGS.theme}</Dim>
        <View style={s.themeRow}>
          {(['system', 'dark', 'light'] as const).map(opt => (
            <View key={opt} style={s.themeCell}>
              <Row
                label={opt}
                value={app.theme === opt ? '●' : undefined}
                onPress={() => app.setTheme(opt)}
                testID={`theme-${opt}`}
              />
            </View>
          ))}
        </View>
        <Dim>{SETTINGS.about}</Dim>
        <Row label={SETTINGS.version('0.1.0')} />
        <Row label={SETTINGS.loadSha('fe7d8ac3')} />
        <View style={s.switchCard}>
          <Text style={s.switchLabel}>{SETTINGS.demo}</Text>
          <Switch
            value={app.demo}
            onValueChange={app.setDemo}
            testID="demo-switch"
          />
        </View>
        <Dim>{SETTINGS.demoOn}</Dim>
        {!app.demo ? (
          <Row label={SETTINGS.bench} onPress={onBench} testID="bench-entry" />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
