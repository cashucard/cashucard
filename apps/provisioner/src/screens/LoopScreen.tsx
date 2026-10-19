/**
 * S3. The loop. One screen carries a batch: the counter, the card figure with
 * honest progress (phase + live block count), the commit button, and every
 * stop state with its three lines in order (what happened, what the card is
 * now, what to do). In demo mode the center is the state chooser — the same
 * runs against the fake card, in the real cadence.
 */
import React, {useState} from 'react';
import {ScrollView, StyleSheet, Text, Vibration, View} from 'react-native';

import type {RunEvent} from '../cardkit';
import {runDemo, stopFor} from '../demo/runDemo';
import {
  DEMO_STATES,
  LOOP,
  PHASES,
  STOP,
  type DemoStateId,
} from '../strings';
import {useApp} from '../store';
import {FONT, useTheme, type Theme} from '../theme';
import {Dim, PrimaryButton, Screen, SecondaryButton} from '../ui';

interface RunUi {
  phase: string;
  block?: {index: number; of: number};
}

const local = (t: Theme) =>
  StyleSheet.create({
    counter: {
      color: t.ink,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 40,
      textAlign: 'center',
    },
    figureWrap: {alignItems: 'center', marginVertical: 12},
    figure: {
      width: 180,
      height: 112,
      borderRadius: 14,
      borderWidth: 2,
      overflow: 'hidden',
      justifyContent: 'flex-end',
      backgroundColor: t.card,
    },
    figureIdle: {borderColor: t.ink},
    figureStop: {borderColor: t.dim},
    figureDanger: {borderColor: t.danger},
    fill: {backgroundColor: t.dim},
    fillDone: {backgroundColor: t.accent},
    phase: {
      color: t.ink,
      fontFamily: FONT.medium,
      fontSize: 17,
      textAlign: 'center',
    },
    doneWrap: {alignItems: 'center', gap: 6},
    doneLine: {color: t.accent, fontFamily: FONT.semibold, fontSize: 20},
    pinLine: {
      color: t.ink,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 18,
    },
    stop: {gap: 6, padding: 14, borderRadius: 12},
    stopDanger: {backgroundColor: t.danger},
    stopPlain: {backgroundColor: t.card},
    stopWhat: {fontFamily: FONT.semibold, fontSize: 17},
    stopWhatDanger: {color: '#fff'},
    stopWhatPlain: {color: t.ink},
    stopCard: {fontFamily: FONT.regular},
    stopCardDanger: {color: '#fff'},
    stopCardPlain: {color: t.dim},
    stopNext: {fontFamily: FONT.medium},
    stopNextDanger: {color: '#fff'},
    stopNextPlain: {color: t.ink},
    chooser: {gap: 8},
    realOff: {gap: 12},
    endBatch: {marginTop: 'auto'},
  });

export function LoopScreen({onEndBatch}: {onEndBatch: () => void}) {
  const app = useApp();
  const t = useTheme();
  const s = local(t);
  const [busy, setBusy] = useState(false);
  const [ui, setUi] = useState<RunUi>({phase: ''});
  /** The stop on screen, if any, and whether its action continues the run. */
  const [stop, setStop] = useState<{id: DemoStateId; cont: boolean} | null>(
    null,
  );
  /** Done only: the short id and, on per-card PIN policy, the PIN. */
  const [done, setDone] = useState<{id: string; pin?: string} | null>(null);
  /** After wrong-keys: the loop stays disarmed until the stop is answered. */
  const [needsAck, setNeedsAck] = useState(false);

  const batch = app.batch!;

  const onEvent = (e: RunEvent) => {
    if (e.type === 'block') {
      setUi(u => ({...u, block: {index: e.index, of: e.of}}));
    } else if (e.type === 'phase') {
      setUi({phase: e.phase});
    }
  };

  async function run(state: DemoStateId, replace: boolean) {
    setBusy(true);
    setStop(null);
    setDone(null);
    setUi({phase: 'probe'});
    const demoRun = await runDemo(state, {replace, onEvent});
    const stopId = stopFor(demoRun);
    setBusy(false);
    if (stopId === 'ok') {
      Vibration.vibrate(40);
      const id = Math.floor(Math.random() * 0xffff)
        .toString(16)
        .padStart(4, '0');
      const pin =
        batch.pinPolicy === 'perCard'
          ? String(Math.floor(1000 + Math.random() * 9000))
          : undefined;
      setDone({id, pin});
      app.addRecord({
        id,
        ok: true,
        demo: state,
        at: Date.now(),
        pending: false,
      });
    } else {
      const cont = (stopId === 'hasOld' || stopId === 'oldVersion') && !replace;
      setStop({id: stopId, cont});
      if (stopId === 'wrongKeys') {
        setNeedsAck(true);
      }
      app.addRecord({
        id: state,
        ok: false,
        demo: state,
        at: Date.now(),
        pending: false,
      });
    }
    setUi({phase: ''});
  }

  const runningPhase =
    ui.phase === 'load' && ui.block
      ? `Writing ${ui.block.index} of ${ui.block.of}`
      : PHASES[ui.phase] ?? '';

  const fill = ui.block ? ui.block.index / ui.block.of : done ? 1 : 0;

  const danger = stop ? STOP[stop.id].danger === true : false;

  const center = (() => {
    if (busy || done || stop) {
      return null; // the run panel below carries it
    }
    if (app.demo) {
      return (
        <ScrollView contentContainerStyle={s.chooser}>
          <Dim>Demo states — the fake card plays them, in real cadence.</Dim>
          {DEMO_STATES.map(d =>
            d.id === 'ok' ? (
              <PrimaryButton
                key={d.id}
                title={d.name}
                testID={`demo-${d.id}`}
                disabled={needsAck}
                onPress={() => {
                  run(d.id, false);
                }}
              />
            ) : (
              <SecondaryButton
                key={d.id}
                title={d.name}
                testID={`demo-${d.id}`}
                disabled={needsAck}
                onPress={() => {
                  run(d.id, false);
                }}
              />
            ),
          )}
        </ScrollView>
      );
    }
    return (
      <View style={s.realOff}>
        <Dim>{LOOP.idle}</Dim>
        <PrimaryButton title={LOOP.program} disabled onPress={() => undefined} />
        <Dim>
          {'Runs against real cards arrive with the key service (Phase 3).'}
        </Dim>
      </View>
    );
  })();

  return (
    <Screen title={app.demo ? 'Demo batch' : 'Batch'}>
      <Text testID="counter" style={s.counter}>
        {LOOP.of(batch.done.filter(r => r.ok).length, batch.count)}
      </Text>

      {/* the card figure: an outline that fills as the load writes */}
      <View style={s.figureWrap}>
        <View
          testID="card-figure"
          style={[
            s.figure,
            stop ? (danger ? s.figureDanger : s.figureStop) : s.figureIdle,
          ]}>
          <View
            style={[s.fill, done ? s.fillDone : null, {height: `${fill * 100}%`}]}
          />
        </View>
      </View>

      {busy ? (
        <Text testID="phase-line" style={s.phase}>
          {runningPhase}
        </Text>
      ) : null}

      {done ? (
        <View style={s.doneWrap}>
          <Text testID="done-line" style={s.doneLine}>
            {LOOP.done(done.id)}
          </Text>
          {done.pin ? (
            <Text testID="pin-line" style={s.pinLine}>
              {LOOP.demoPin(done.pin)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {stop ? (
        <View
          testID="stop"
          style={[s.stop, danger ? s.stopDanger : s.stopPlain]}>
          <Text style={[s.stopWhat, danger ? s.stopWhatDanger : s.stopWhatPlain]}>
            {STOP[stop.id].what}
          </Text>
          <Text style={[s.stopCard, danger ? s.stopCardDanger : s.stopCardPlain]}>
            {STOP[stop.id].card}
          </Text>
          <Text style={[s.stopNext, danger ? s.stopNextDanger : s.stopNextPlain]}>
            {STOP[stop.id].next}
          </Text>
          <PrimaryButton
            title={STOP[stop.id].action ?? 'OK'}
            danger={danger}
            testID="stop-action"
            onPress={() => {
              if (stop.cont) {
                run(stop.id, true);
              } else {
                setStop(null);
                setNeedsAck(false);
              }
            }}
          />
        </View>
      ) : null}

      {center}

      <View style={s.endBatch}>
        <SecondaryButton title="END BATCH" onPress={onEndBatch} />
      </View>
    </Screen>
  );
}
