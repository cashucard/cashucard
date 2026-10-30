/**
 * The spike's one screen (ENG-738): install the hello applet, install the
 * Cashu card, or rotate the card manager's keys and back, each in one tap, and
 * show what the run measured. For the spare card on the bench only.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ScrollView, Share, StyleSheet, Switch, Text, View} from 'react-native';

import {
  CASHU_PLAN,
  FACTORY_KEYS,
  HELLO_PLAN,
  SPIKE_KEYS,
  provision,
  rotateKeys,
  type RunEvent,
  type RunResult,
  type Transceiver,
} from '../cardkit';
import {
  ACTION_NAMES,
  HOLD,
  describeResult,
  describeSessionError,
  describeShareFailure,
  labelFor,
  type Action,
} from '../copy';
import {randomBytes} from '../random';
import {formatReadout, locksOut, makeReadout, type Readout} from '../readout';
import {cancelCard, setCardMessage, withCard} from '../session';
import {BENCH_RUNS_ENABLED} from '../releaseGates';
import {FONT, useTheme, type Theme} from '../theme';
import {Screen, SecondaryButton} from '../ui';

async function runAction(
  action: Action,
  tx: Transceiver,
  replace: boolean,
  onEvent: (e: RunEvent) => void,
): Promise<RunResult<string>[]> {
  const options = {random: randomBytes, now: Date.now, onEvent};
  if (action === 'rotate') {
    const there = await rotateKeys(tx, FACTORY_KEYS, SPIKE_KEYS, options);
    if (!there.ok) {
      return [there];
    }
    return [there, await rotateKeys(tx, SPIKE_KEYS, FACTORY_KEYS, options)];
  }
  const plan = action === 'hello' ? HELLO_PLAN : CASHU_PLAN;
  return [await provision(tx, plan, {...options, replace})];
}

export function LoadTestScreen(): React.JSX.Element {
  const t = useTheme();
  const styles = local(t);
  const [running, setRunning] = useState<Action | null>(null);
  const [stopped, setStopped] = useState(false);
  const [replace, setReplace] = useState(false);
  const [status, setStatus] = useState(
    BENCH_RUNS_ENABLED ? HOLD : 'Bench tools are unavailable in this build.',
  );
  const [readout, setReadout] = useState<Readout | null>(null);
  const progress = useRef('');
  const cancelled = useRef(false);

  // leaving the screen ends any session (cancelCard never throws)
  useEffect(
    () => () => {
      if (BENCH_RUNS_ENABLED) {
        cancelCard();
      }
    },
    [],
  );

  const start = useCallback(
    async (action: Action) => {
      if (!BENCH_RUNS_ENABLED || running || stopped) {
        return;
      }
      setRunning(action);
      setReadout(null);
      setStatus(HOLD);
      progress.current = '';
      cancelled.current = false;
      const onEvent = (e: RunEvent) => {
        const label = labelFor(action, e);
        if (label) {
          progress.current = label;
          setStatus(label);
          setCardMessage(label);
        }
      };
      try {
        const {value, stamps, meta} = await withCard(HOLD, tx =>
          runAction(action, tx, replace, onEvent),
        );
        const last = value[value.length - 1];
        if (locksOut(last)) {
          setStopped(true);
        }
        setStatus(
          describeResult(
            action,
            last,
            progress.current,
            cancelled.current,
            replace,
          ),
        );
        setReadout(
          makeReadout({
            action: ACTION_NAMES[action],
            results: value,
            stamps,
            meta,
          }),
        );
      } catch (e) {
        setStatus(describeSessionError(e));
      } finally {
        setRunning(null);
      }
    },
    [running, stopped, replace],
  );

  const idle = BENCH_RUNS_ENABLED && running === null && !stopped;
  const text = readout ? formatReadout(readout) : '';

  return (
    <Screen title="Bench tools">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Cashu card provisioner</Text>
        <Text style={styles.note}>
          Bench tool for the spare J3R180. Factory keys; the rotation uses the
          spike's public test set.
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          style={styles.status}
          testID="status">
          {status}
        </Text>
        <View style={styles.buttons}>
          <SecondaryButton
            title={ACTION_NAMES.hello}
            disabled={!idle}
            onPress={() => start('hello')}
          />
          <SecondaryButton
            title={ACTION_NAMES.cashu}
            disabled={!idle}
            onPress={() => start('cashu')}
          />
          <SecondaryButton
            title={ACTION_NAMES.rotate}
            disabled={!idle}
            onPress={() => start('rotate')}
          />
          <SecondaryButton
            title="Cancel"
            disabled={running === null}
            onPress={() => {
              cancelled.current = true;
              cancelCard();
            }}
          />
        </View>
        <View style={styles.row}>
          <Switch
            value={replace}
            onValueChange={setReplace}
            disabled={!idle}
            accessibilityLabel="Replace existing install (spare card only)"
          />
          <Text style={styles.label}>
            Replace existing install (spare card only)
          </Text>
        </View>
        {readout ? (
          <View>
            <Text selectable style={styles.readout} testID="readout">
              {text}
            </Text>
            <SecondaryButton
              title="Share readout"
              onPress={() => {
                Share.share({message: text}).catch(e =>
                  setStatus(describeShareFailure(e)),
                );
              }}
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const local = (t: Theme) =>
  StyleSheet.create({
    content: {padding: 16, gap: 12},
    title: {color: t.ink, fontSize: 20, fontFamily: FONT.semibold},
    note: {color: t.dim, fontSize: 13},
    status: {color: t.ink, fontSize: 17, minHeight: 48},
    buttons: {gap: 8},
    row: {flexDirection: 'row', alignItems: 'center', gap: 8},
    label: {flex: 1, color: t.ink},
    readout: {color: t.ink, fontFamily: 'Courier', fontSize: 12},
  });
