/**
 * S2. Batch setup: mint, PIN policy, limits, count, then START BATCH. In demo
 * mode the batch comes preconfigured (DEMO marks), so the reviewer reaches
 * the loop without form work; the fields present as they will, greyed.
 */
import React, {useState} from 'react';
import {ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';

import {SETUP} from '../strings';
import {DEMO_BATCH, useApp, type BatchConfig} from '../store';
import {FONT, useTheme, type Theme} from '../theme';
import {Dim, PrimaryButton, Row, Screen} from '../ui';

const DEMO_MINTS = ['https://mint.demo.invalid'];

const local = (t: Theme) =>
  StyleSheet.create({
    scroll: {gap: 12, paddingBottom: 32},
    cluster: {gap: 8},
    input: {
      backgroundColor: t.card,
      borderRadius: 12,
      padding: 12,
      color: t.ink,
      fontFamily: FONT.medium,
    },
    actions: {marginTop: 8, gap: 8},
    buildLine: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 12,
      textAlign: 'center',
    },
  });

export function BatchSetupScreen({
  onStart,
  onSettings,
}: {
  onStart: () => void;
  onSettings: () => void;
}) {
  const app = useApp();
  const t = useTheme();
  const s = local(t);
  const [mint, setMint] = useState<string | null>(null);
  const [pinPolicy, setPinPolicy] = useState<'batch' | 'perCard'>('perCard');
  const [pinBatch, setPinBatch] = useState('');
  const [daily, setDaily] = useState('25.00');
  const [noPin, setNoPin] = useState('5.00');
  const [count, setCount] = useState('12');

  const field = (
    v: string,
    set: (v: string) => void,
    placeholder: string,
  ) => (
    <TextInput
      value={v}
      onChangeText={set}
      placeholder={placeholder}
      placeholderTextColor={t.dim}
      editable={!app.demo}
      keyboardType="default"
      style={s.input}
    />
  );

  const ready =
    app.demo || (mint !== null && count.length > 0 && daily.length > 0);

  const start = () => {
    const config: BatchConfig = app.demo
      ? DEMO_BATCH
      : {
          mint: mint!,
          pinPolicy,
          pinBatch,
          dailyUsd: Number(daily) || 0,
          noPinUsd: Number(noPin) || 0,
          count: Number(count) || 1,
        };
    app.startBatch(config);
    onStart();
  };

  return (
    <Screen title={SETUP.title} onBack={undefined}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Dim>{SETUP.mint}</Dim>
        <View style={s.cluster}>
          {DEMO_MINTS.map(m => (
            <Row
              key={m}
              label={m}
              value={mint === m || app.demo ? '●' : undefined}
              onPress={() => setMint(m)}
              testID={`mint-${m}`}
            />
          ))}
        </View>
        <Dim>PIN</Dim>
        <View style={s.cluster}>
          <Row
            label={SETUP.pinPerCard}
            value={pinPolicy === 'perCard' ? '●' : undefined}
            onPress={() => setPinPolicy('perCard')}
            testID="pin-perCard"
          />
          <Row
            label={SETUP.pinBatch}
            value={pinPolicy === 'batch' ? '●' : undefined}
            onPress={() => setPinPolicy('batch')}
            testID="pin-batch"
          />
          {pinPolicy === 'batch'
            ? field(pinBatch, setPinBatch, '4–8 digits')
            : null}
        </View>
        <Dim>{SETUP.limits}</Dim>
        {field(daily, setDaily, SETUP.daily)}
        {field(noPin, setNoPin, SETUP.noPin)}
        <Dim>{SETUP.count}</Dim>
        {field(count, setCount, '0')}
        <View style={s.actions}>
          <PrimaryButton
            title={SETUP.start}
            disabled={!ready}
            onPress={start}
            testID="start-batch"
          />
          <Text style={s.buildLine}>{SETUP.buildLine('fe7d8ac3')}</Text>
          <PrimaryButton title="Settings" onPress={onSettings} />
        </View>
      </ScrollView>
    </Screen>
  );
}
