/**
 * S5. Settings, grouped the way a 2026 settings screen is grouped: section
 * headers, one card per group, hairline dividers, a segmented theme pill,
 * the key environment as a locked row, and demo mode as its own switch card.
 */
import React from 'react';
import {Pressable, ScrollView, StyleSheet, Switch, Text, View} from 'react-native';

import {SETTINGS} from '../strings';
import {useApp} from '../store';
import {FONT, useTheme, type Theme} from '../theme';
import {Screen} from '../ui';

const local = (t: Theme) =>
  StyleSheet.create({
    scroll: {gap: 22, paddingBottom: 32},
    section: {gap: 8},
    header: {
      color: t.dim,
      fontFamily: FONT.semibold,
      fontSize: 12,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    card: {
      backgroundColor: t.card,
      borderRadius: 16,
      overflow: 'hidden',
    },
    row: {
      paddingHorizontal: 18,
      paddingVertical: 15,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    divider: {height: StyleSheet.hairlineWidth, backgroundColor: t.line},
    rowLabel: {flex: 1, color: t.ink, fontFamily: FONT.medium, fontSize: 16},
    rowValue: {
      color: t.dim,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 15,
    },
    pill: {
      flexDirection: 'row',
      backgroundColor: t.bg,
      borderRadius: 12,
      padding: 3,
      gap: 2,
    },
    pillItem: {
      paddingHorizontal: 16,
      paddingVertical: 7,
      borderRadius: 10,
    },
    pillItemOn: {backgroundColor: t.ink},
    pillText: {color: t.dim, fontFamily: FONT.medium, fontSize: 14},
    pillTextOn: {color: t.bg, fontFamily: FONT.semibold, fontSize: 14},
    demoNote: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 13,
      lineHeight: 19,
    },
    lock: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: t.accent,
    },
    chevron: {color: t.dim, fontFamily: FONT.regular, fontSize: 22},
    rowCenter: {justifyContent: 'center'},
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
        <View style={s.section}>
          <Text style={s.header}>{SETTINGS.keyEnv}</Text>
          <View style={s.card}>
            <View style={s.row}>
              <View style={s.lock} />
              <Text style={s.rowLabel}>{SETTINGS.factory}</Text>
              <Text style={s.rowValue}>●</Text>
            </View>
            <View style={s.divider} />
            <View style={s.row}>
              <View style={[s.lock, {backgroundColor: t.dim}]} />
              <Text style={[s.rowLabel, {color: t.dim}]}>
                {SETTINGS.issued}
              </Text>
              <Text style={s.rowValue}>—</Text>
            </View>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.header}>{SETTINGS.theme}</Text>
          <View style={s.card}>
            <View style={[s.row, s.rowCenter]}>
              <View style={s.pill}>
                {(['system', 'dark', 'light'] as const).map(opt => {
                  const on = app.theme === opt;
                  return (
                    <Pressable
                      key={opt}
                      testID={`theme-${opt}`}
                      onPress={() => app.setTheme(opt)}
                      style={[s.pillItem, on && s.pillItemOn]}>
                      <Text style={on ? s.pillTextOn : s.pillText}>
                        {opt === 'system'
                          ? SETTINGS.themeSystem
                          : opt === 'dark'
                            ? SETTINGS.themeDark
                            : SETTINGS.themeLight}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.header}>{SETTINGS.about}</Text>
          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.rowLabel}>{SETTINGS.version('0.1.0')}</Text>
            </View>
            <View style={s.divider} />
            <View style={s.row}>
              <Text style={s.rowLabel}>{SETTINGS.loadSha('fe7d8ac3')}</Text>
            </View>
            <View style={s.divider} />
            <Pressable
              testID="bench-entry"
              onPress={onBench}
              style={s.row}>
              <Text style={s.rowLabel}>{SETTINGS.bench}</Text>
              <Text style={s.chevron}>›</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.section}>
          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.rowLabel}>{SETTINGS.demo}</Text>
              <Switch
                value={app.demo}
                onValueChange={app.setDemo}
                testID="demo-switch"
              />
            </View>
            <View style={s.divider} />
            <View style={s.row}>
              <Text style={s.demoNote}>{SETTINGS.demoOn}</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
