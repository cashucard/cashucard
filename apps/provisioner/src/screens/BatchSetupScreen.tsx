/**
 * S2. Batch setup: mint, PIN policy, limits, count, then START BATCH. In demo
 * mode the batch comes preconfigured (DEMO marks), so the reviewer reaches
 * the loop without form work; the fields present as they will, greyed.
 *
 * The design language is Settings': section headers in small caps, one raised
 * card per group, hairline dividers, the accent only where a choice is live.
 * Everything fits one screen on a phone; the only scrolling part is a mint
 * list that grows past four.
 */
import React, {useEffect, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {ApiClient} from '../api';
import {SETUP} from '../strings';
import {DEMO_BATCH, useApp, type BatchConfig} from '../store';
import {FONT, useTheme, type Theme} from '../theme';
import {GearButton, Screen, PrimaryButton} from '../ui';

// Demo's mints (ENG-760: editable mint field with defaults). Real mode
// fetches the service's list instead (ENG-740); these stay for demo only.
const DEMO_MINTS = [
  'https://forge.flashapp.me',
  'https://mint.minibits.cash',
  'https://mint.macadamia.cash',
  'https://mint.cubabitcoin.org',
];

/** The design code this build's card art draws (docs/CARD-DESIGNS.md). */
const CARD_DESIGN = 'FL1 — Flash, black, the bolt';

const local = (t: Theme) =>
  StyleSheet.create({
    scroll: {gap: 20, paddingBottom: 24},
    grow: {flex: 1},
    section: {gap: 8},
    sectionHeader: {
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
    divider: {height: StyleSheet.hairlineWidth, backgroundColor: t.line},
    mintGrid: {flexDirection: 'row', flexWrap: 'wrap'},
    mintCell: {width: '50%'},
    mintCellBorder: {
      borderRightWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: t.line,
    },
    mintName: {
      color: t.ink,
      fontFamily: FONT.medium,
      fontSize: 13,
    },
    cardSub: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 12,
      marginTop: 2,
    },
    cellRow: {
      padding: 14,
      minHeight: 52,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cellSelected: {backgroundColor: t.accent},
    cellDot: {
      position: 'absolute',
      top: 10,
      right: 12,
      color: t.accent,
      fontFamily: FONT.semibold,
      fontSize: 14,
    },
    cellDotOnAccent: {color: t.bg},
    cellLabelOnAccent: {color: t.bg},
    demoNote: {color: t.dim, fontFamily: FONT.regular, fontSize: 13},
    cellWide: {minHeight: 48},
    customInput: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 13,
      flex: 1,
      padding: 0,
    },
    emptyInput: {
      color: t.ink,
      fontFamily: FONT.regular,
      fontSize: 14,
      flex: 1,
      padding: 0,
    },
    cellRowEdgeR: {borderRightWidth: 0},
    cellRowEdgeB: {borderBottomWidth: 0},
    designCol: {flex: 1},
    fieldRow: {
      paddingHorizontal: 16,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 52,
    },
    fieldLabel: {color: t.dim, fontFamily: FONT.medium, fontSize: 14, flex: 1},
    fieldInput: {
      color: t.ink,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 17,
      textAlign: 'right',
      flex: 1.2,
      padding: 0,
    },
    policyRow: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: t.dim,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOn: {borderColor: t.accent},
    radioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: t.accent,
    },
    policyLabel: {color: t.ink, fontFamily: FONT.medium, fontSize: 15, flex: 1},
    pinInput: {
      backgroundColor: t.bg,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginHorizontal: 16,
      marginBottom: 12,
      color: t.ink,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 17,
      letterSpacing: 4,
    },
    footer: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 8,
      gap: 8,
    },
    buildLine: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 12,
      textAlign: 'center',
    },
    designRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 13,
    },
    designChip: {
      width: 28,
      height: 40,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: t.ink,
      backgroundColor: t.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    designChipBolt: {color: t.ink, fontFamily: FONT.semibold, fontSize: 13},
  });

export function BatchSetupScreen({
  onStart,
  onSettings,
  onCreate,
  canStart = true,
  installationOnly = false,
  loadSha256,
}: {
  onStart: () => void;
  onSettings: () => void;
  onCreate?: (config: BatchConfig) => Promise<boolean>;
  canStart?: boolean;
  installationOnly?: boolean;
  loadSha256?: string;
}) {
  const app = useApp();
  const t = useTheme();
  const s = local(t);
  const [mint, setMint] = useState<string | null>(null);
  const [pinPolicy, setPinPolicy] = useState<'batch' | 'perCard'>('perCard');
  const [pinBatch, setPinBatch] = useState('');
  const [daily, setDaily] = useState('25.00');
  const [noPin, setNoPin] = useState('5.00');
  const [count, setCount] = useState(app.demo ? '250' : '12');

  const [creating, setCreating] = useState(false);
  const validNumbers =
    Number.isSafeInteger(Number(count)) &&
    Number(count) > 0 &&
    Number(count) <= 100000 &&
    daily.trim().length > 0 &&
    noPin.trim().length > 0 &&
    Number.isFinite(Number(daily)) &&
    Number(daily) >= 0 &&
    Number.isFinite(Number(noPin)) &&
    Number(noPin) >= 0;
  const ready =
    canStart && !creating && (app.demo || (mint !== null && validNumbers));

  const start = async () => {
    if (!ready) {
      return;
    }
    const config: BatchConfig = app.demo
      ? DEMO_BATCH
      : {
          mint: mint!,
          pinPolicy,
          pinBatch,
          dailyUsd: Number(daily),
          noPinUsd: Number(noPin),
          count: Number(count),
        };
    if (onCreate) {
      setCreating(true);
      try {
        if (await onCreate({...config, pinBatch: ''})) {
          onStart();
        }
      } finally {
        setCreating(false);
      }
    } else {
      app.startBatch(config);
      onStart();
    }
  };

  // Real mode reads the ops service's mint list; demo keeps its own.
  const [serviceMints, setServiceMints] = useState<string[] | null>(null);
  const [mintsFailed, setMintsFailed] = useState(false);
  useEffect(() => {
    if (app.demo || !app.session) {
      return;
    }
    let alive = true;
    const client = new ApiClient({baseUrl: app.serviceUrl});
    client
      .mints(app.session.token)
      .then(m => {
        if (alive) {
          setServiceMints(m);
        }
      })
      .catch(() => {
        if (alive) {
          setMintsFailed(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [app.demo, app.session, app.serviceUrl]);
  const mints = app.demo || !serviceMints ? DEMO_MINTS : serviceMints;

  const customMint = mint !== null && !mints.includes(mint);

  return (
    <Screen
      title={SETUP.title}
      onBack={undefined}
      headerRight={<GearButton onPress={onSettings} testID="settings" />}>
      <View style={s.grow}>
        <ScrollView contentContainerStyle={s.scroll} testID="setup-scroll">
          {app.demo ? (
            <Text style={s.demoNote}>
              {'Demo batch — placeholder values. Nothing leaves the phone.'}
            </Text>
          ) : mintsFailed ? (
            <Text style={s.demoNote}>{SETUP.mintsFailed}</Text>
          ) : null}

          <View style={s.section}>
            <Text style={s.sectionHeader}>{SETUP.mint}</Text>
            <View style={s.card}>
              <View style={s.mintGrid}>
                {mints.map((m, i) => {
                  const host = m.replace(/^https:\/\//, '');
                  const on = mint === m;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => setMint(m)}
                      testID={`mint-${m}`}
                      style={[
                        s.mintCell,
                        s.cellRow,
                        s.mintCellBorder,
                        i % 2 === 1 && s.cellRowEdgeR,
                        i >= mints.length - 2 && mints.length % 2 === 0
                          ? s.cellRowEdgeB
                          : null,
                        on ? s.cellSelected : null,
                      ]}>
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.8}
                        style={[s.mintName, on ? s.cellLabelOnAccent : null]}>
                        {host}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {customMint ? (
                <>
                  <View style={s.divider} />
                  <View style={[s.cellRow, s.cellWide]}>
                    <Text style={s.cellDot}>●</Text>
                    <Text style={s.mintName}>Custom</Text>
                    <TextInput
                      value={mint ?? ''}
                      onChangeText={setMint}
                      placeholder="Enter custom mint URL"
                      placeholderTextColor={t.dim}
                      keyboardType="url"
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={s.customInput}
                      testID="mint-custom-input"
                    />
                  </View>
                </>
              ) : null}
              {!mint && !app.demo ? (
                <>
                  <View style={s.divider} />
                  <View style={[s.cellRow, s.cellWide]}>
                    <TextInput
                      value=""
                      onChangeText={v => setMint(v || null)}
                      placeholder="Or enter a mint URL…"
                      placeholderTextColor={t.dim}
                      keyboardType="url"
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={s.emptyInput}
                      testID="mint-custom-input"
                    />
                  </View>
                </>
              ) : null}
            </View>
          </View>

          <View style={s.section}>
            <Text style={s.sectionHeader}>PIN</Text>
            <View style={s.card}>
              <Pressable
                style={s.policyRow}
                onPress={() => setPinPolicy('perCard')}
                testID="pin-perCard">
                <View style={[s.radio, pinPolicy === 'perCard' && s.radioOn]}>
                  {pinPolicy === 'perCard' ? <View style={s.radioDot} /> : null}
                </View>
                <Text style={s.policyLabel}>{SETUP.pinPerCard}</Text>
              </Pressable>
              <View style={s.divider} />
              <Pressable
                style={s.policyRow}
                onPress={() => setPinPolicy('batch')}
                testID="pin-batch">
                <View style={[s.radio, pinPolicy === 'batch' && s.radioOn]}>
                  {pinPolicy === 'batch' ? <View style={s.radioDot} /> : null}
                </View>
                <Text style={s.policyLabel}>{SETUP.pinBatch}</Text>
              </Pressable>
              {pinPolicy === 'batch' && !installationOnly ? (
                <TextInput
                  value={pinBatch}
                  onChangeText={v =>
                    setPinBatch(v.replace(/\D/g, '').slice(0, 8))
                  }
                  placeholder="4–8 digits"
                  placeholderTextColor={t.dim}
                  keyboardType="numeric"
                  secureTextEntry
                  style={s.pinInput}
                  testID="pin-batch-input"
                />
              ) : null}
            </View>
          </View>

          <View style={s.section}>
            <Text style={s.sectionHeader}>{SETUP.limits}</Text>
            <View style={s.card}>
              <View style={s.fieldRow}>
                <Text style={s.fieldLabel}>{SETUP.daily}</Text>
                <TextInput
                  value={daily}
                  onChangeText={setDaily}
                  keyboardType="numeric"
                  editable={!app.demo}
                  style={s.fieldInput}
                  testID="daily-limit"
                />
              </View>
              <View style={s.divider} />
              <View style={s.fieldRow}>
                <Text style={s.fieldLabel}>{SETUP.noPin}</Text>
                <TextInput
                  value={noPin}
                  onChangeText={setNoPin}
                  keyboardType="numeric"
                  editable={!app.demo}
                  style={s.fieldInput}
                  testID="no-pin-limit"
                />
              </View>
              <View style={s.divider} />
              <View style={s.fieldRow}>
                <Text style={s.fieldLabel}>{SETUP.count}</Text>
                <TextInput
                  value={count}
                  onChangeText={setCount}
                  keyboardType="numeric"
                  editable={!app.demo}
                  style={s.fieldInput}
                  testID="batch-count"
                />
              </View>
            </View>
          </View>

          <View style={s.section}>
            <View style={s.card}>
              <View style={s.designRow}>
                <View style={s.designChip}>
                  <Text style={s.designChipBolt}>⚡</Text>
                </View>
                <View style={s.grow}>
                  <Text style={s.mintName}>Card design</Text>
                  <Text style={s.cardSub}>{CARD_DESIGN}</Text>
                </View>
              </View>
            </View>
          </View>
        </ScrollView>

        <View style={s.footer} testID="setup-footer">
          {installationOnly ? (
            <Text style={s.buildLine}>
              Installation and key rotation only. Mint, owner, PIN and limits
              are not applied yet.
            </Text>
          ) : null}
          <PrimaryButton
            title={SETUP.start}
            disabled={!ready}
            onPress={start}
            testID="start-batch"
          />
          <Text style={s.buildLine}>
            {SETUP.buildLine(loadSha256?.slice(0, 8) ?? 'fe7d8ac3')}
          </Text>
        </View>
      </View>
    </Screen>
  );
}
