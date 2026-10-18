/**
 * The spike's one screen (ENG-738): install the hello applet, install the
 * Cashu card, or rotate the card manager's keys and back, each in one tap, and
 * show what the run measured. For the spare card on the bench only.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

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
  labelFor,
  type Action,
} from '../copy';
import {randomBytes} from '../random';
import {formatReadout, locksOut, makeReadout, type Readout} from '../readout';
import {cancelCard, setCardMessage, withCard} from '../session';

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
  const [running, setRunning] = useState<Action | null>(null);
  const [stopped, setStopped] = useState(false);
  const [replace, setReplace] = useState(false);
  const [status, setStatus] = useState(HOLD);
  const [readout, setReadout] = useState<Readout | null>(null);
  const progress = useRef('');
  const cancelled = useRef(false);

  // leaving the screen ends any session (cancelCard never throws)
  useEffect(
    () => () => {
      cancelCard();
    },
    [],
  );

  const start = useCallback(
    async (action: Action) => {
      if (running || stopped) {
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
          describeResult(action, last, progress.current, cancelled.current),
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

  const idle = running === null && !stopped;
  const text = readout ? formatReadout(readout) : '';

  return (
    <SafeAreaView style={styles.screen}>
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
          <Button
            title={ACTION_NAMES.hello}
            disabled={!idle}
            onPress={() => start('hello')}
          />
          <Button
            title={ACTION_NAMES.cashu}
            disabled={!idle}
            onPress={() => start('cashu')}
          />
          <Button
            title={ACTION_NAMES.rotate}
            disabled={!idle}
            onPress={() => start('rotate')}
          />
          <Button
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
            <Button
              title="Share readout"
              onPress={() => {
                Share.share({message: text}).catch(() => undefined);
              }}
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  content: {padding: 16, gap: 12},
  title: {fontSize: 20, fontWeight: '600'},
  note: {fontSize: 13, opacity: 0.7},
  status: {fontSize: 17, minHeight: 48},
  buttons: {gap: 8},
  row: {flexDirection: 'row', alignItems: 'center', gap: 8},
  label: {flex: 1},
  readout: {fontFamily: 'Courier', fontSize: 12},
});
