/**
 * S4. Batch summary and the record. The count, the stops, every row the
 * service would hold, and SHARE RECORD as text. Demo rows are marked DEMO.
 */
import React from 'react';
import {ScrollView, Share, StyleSheet, Text} from 'react-native';

import {SUMMARY} from '../strings';
import {describeShareFailure} from '../copy';
import {useApp} from '../store';
import {FONT, useTheme, type Theme} from '../theme';
import {Dim, PrimaryButton, Row, Screen} from '../ui';

const local = (t: Theme) =>
  StyleSheet.create({
    scroll: {gap: 8, paddingBottom: 24},
    count: {
      color: t.ink,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 34,
      textAlign: 'center',
    },
  });

export function BatchSummaryScreen({
  onBack,
  onClose,
}: {
  onBack: () => void;
  onClose: () => void;
}) {
  const app = useApp();
  const t = useTheme();
  const s = local(t);
  const batch = app.batch!;
  const [note, setNote] = React.useState<string | null>(null);

  const done = batch.done.filter(r => r.ok);
  const stopped = batch.done.filter(r => !r.ok);
  const pending = done.filter(r => r.pending);
  const text =
    `Batch record — ${done.length} of ${batch.count} programmed\n` +
    batch.done
      .map(
        r =>
          `${r.ok ? 'ok' : 'stopped'} ${r.id}${r.demo ? ` (demo: ${r.demo})` : ''}` +
          ` ${new Date(r.at).toISOString()}${r.pending ? ' record pending' : ''}`,
      )
      .join('\n');

  return (
    <Screen title={SUMMARY.title} onBack={onBack}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.count}>{`${done.length} of ${batch.count}`}</Text>
        {stopped.map((r, i) => (
          <Row
            key={`stop-${i}`}
            label={`Stopped: ${r.demo ?? r.id}`}
            value={new Date(r.at).toISOString().slice(11, 19)}
          />
        ))}
        {done.map((r, i) => (
          <Row
            key={`ok-${i}`}
            label={`${SUMMARY.recorded(r.id)}${r.demo ? ' DEMO' : ''}`}
            value={r.pending ? SUMMARY.pending : undefined}
          />
        ))}
        {pending.length > 0 ? <Dim>{SUMMARY.pendingNote}</Dim> : null}
        <PrimaryButton
          title={SUMMARY.share}
          testID="share-record"
          onPress={() => {
            Share.share({message: text}).catch(e =>
              setNote(describeShareFailure(e)),
            );
          }}
        />
        {note ? <Dim>{note}</Dim> : null}
        <PrimaryButton
          title="CLOSE BATCH"
          testID="close-batch"
          onPress={() => {
            app.endBatch();
            onClose();
          }}
        />
      </ScrollView>
    </Screen>
  );
}
