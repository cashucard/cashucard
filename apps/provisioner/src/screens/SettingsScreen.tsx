/**
 * S5. Settings, grouped the way a 2026 settings screen is grouped: section
 * headers, one card per group, hairline dividers, a segmented theme pill,
 * the key environment as a locked row, and demo mode as its own switch card.
 *
 * The batch-setup revamp's rules hold here too: tabular figures for every
 * number, the accent only where a thing is live (the factory key set's dot,
 * the theme pill's active segment), and nothing that pretends to be a button
 * that is not.
 */
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import {SETTINGS} from '../strings';
import {useApp} from '../store';
import {LegalLinks} from '../LegalLinks';
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
      minHeight: 52,
    },
    divider: {height: StyleSheet.hairlineWidth, backgroundColor: t.line},
    rowLabel: {flex: 1, color: t.ink, fontFamily: FONT.medium, fontSize: 16},
    rowSub: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 12,
      marginTop: 2,
    },
    rowValue: {
      color: t.dim,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 15,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: t.accent,
    },
    dotOff: {
      width: 8,
      height: 8,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: t.dim,
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
    chevron: {color: t.dim, fontFamily: FONT.regular, fontSize: 22},
    // The identity block: wordmark-size version, the load sha as the small print
    // under it, both centered — the same "which build am I holding" posture the
    // batch screen's footer line keeps.
    identity: {
      alignItems: 'center',
      paddingVertical: 20,
      gap: 4,
    },
    version: {
      color: t.ink,
      fontFamily: FONT.semibold,
      fontSize: 17,
      fontVariant: ['tabular-nums'],
    },
    loadSha: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
    },
    rowCenter: {justifyContent: 'center'},
    rowLabelCol: {flex: 1},
  });

export function SettingsScreen({
  onBack,
  onBench,
  onIdentity,
  hardwareBusy = false,
}: {
  onBack: () => void;
  onBench: () => void;
  onIdentity?: () => void;
  hardwareBusy?: boolean;
}) {
  const app = useApp();
  const t = useTheme();
  const s = local(t);
  // S5: exactly one of the two environments is ever lit — the session's own.
  const env = app.session?.env ?? 'factory';
  const factoryActive = env === 'factory';
  return (
    <Screen title={SETTINGS.title} onBack={onBack}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.section}>
          <Text style={s.header}>{SETTINGS.keyEnv}</Text>
          <View style={s.card}>
            <View style={s.row}>
              <View style={factoryActive ? s.dot : s.dotOff} />
              <View style={s.rowLabelCol}>
                <Text style={[s.rowLabel, !factoryActive && {color: t.dim}]}>
                  {SETTINGS.factory}
                </Text>
              </View>
              <Text style={s.rowValue}>{factoryActive ? 'active' : '—'}</Text>
            </View>
            <View style={s.divider} />
            <View style={s.row}>
              <View style={!factoryActive ? s.dot : s.dotOff} />
              <View style={s.rowLabelCol}>
                <Text style={[s.rowLabel, factoryActive && {color: t.dim}]}>
                  {SETTINGS.issued}
                </Text>
              </View>
              <Text style={s.rowValue}>{!factoryActive ? 'active' : '—'}</Text>
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
          <Text style={s.header}>{SETTINGS.demo}</Text>
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

        <View style={s.section}>
          <Text style={s.header}>{SETTINGS.bench}</Text>
          <View style={s.card}>
            {onIdentity ? (
              <>
                <Pressable
                  testID="identity-entry"
                  onPress={onIdentity}
                  disabled={hardwareBusy}
                  style={s.row}>
                  <View style={s.rowLabelCol}>
                    <Text style={s.rowLabel}>Read physical card identity</Text>
                    <Text style={s.rowSub}>
                      Read-only CPLC check. No installation or authentication.
                    </Text>
                  </View>
                  <Text style={s.chevron}>›</Text>
                </Pressable>
                <View style={s.divider} />
              </>
            ) : null}
            <Pressable testID="bench-entry" onPress={onBench} style={s.row}>
              <View style={s.rowLabelCol}>
                <Text style={s.rowLabel}>{SETTINGS.bench}</Text>
                <Text style={s.rowSub}>
                  {'Load test against the spare card. Bench only.'}
                </Text>
              </View>
              <Text style={s.chevron}>›</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.header}>{SETTINGS.session}</Text>
          <View style={s.card}>
            <Pressable testID="sign-out" onPress={app.signOut} style={s.row}>
              <View style={s.rowLabelCol}>
                <Text style={s.rowLabel}>{SETTINGS.signOut}</Text>
                <Text style={s.rowSub}>{SETTINGS.signOutSub}</Text>
              </View>
            </Pressable>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.header}>{SETTINGS.about}</Text>
          <View style={s.card}>
            <View style={s.identity}>
              <Text style={s.version}>{SETTINGS.version('0.1.0')}</Text>
              <Text style={s.loadSha}>{SETTINGS.loadSha('fe7d8ac3')}</Text>
              <Text style={s.loadSha}>{app.serviceUrl}</Text>
              <Text style={s.loadSha}>{SETTINGS.capPin('fe7d8ac3')}</Text>
            </View>
          </View>
        </View>
        <LegalLinks />
      </ScrollView>
    </Screen>
  );
}
