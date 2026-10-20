/**
 * S4. Batch summary and the record. The count, the stops, every row the
 * service would hold, and SHARE RECORD as text. Demo rows are marked DEMO.
 *
 * The design tier of the other screens: a stat header (three figures, the
 * accent only on programmed), the record as one grouped card with per-row
 * state dots and tabular ids, and the two actions pinned in a footer.
 */
import React from 'react';
import {ScrollView, Share, StyleSheet, Text, View} from 'react-native';

import {SUMMARY} from '../strings';
import {describeShareFailure} from '../copy';
import {useApp} from '../store';
import {FONT, useTheme, type Theme} from '../theme';
import {PrimaryButton, Screen, SecondaryButton} from '../ui';

const local = (t: Theme) =>
  StyleSheet.create({
    scroll: {gap: 20, paddingBottom: 24, flexGrow: 1},
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
    stats: {flexDirection: 'row', gap: 10},
    stat: {
      flex: 1,
      backgroundColor: t.card,
      borderRadius: 16,
      paddingVertical: 16,
      alignItems: 'center',
      gap: 2,
    },
    statFigure: {
      color: t.ink,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 32,
    },
    statFigureAccent: {color: t.accent},
    statLabel: {
      color: t.dim,
      fontFamily: FONT.medium,
      fontSize: 12,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    recordRow: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minHeight: 44,
    },
    stateDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: t.accent,
    },
    stateDotStopped: {backgroundColor: t.danger},
    stateDotPending: {
      width: 8,
      height: 8,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: t.accent,
    },
    recordId: {
      color: t.ink,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 15,
      flex: 1,
    },
    recordDemo: {
      color: t.dim,
      fontFamily: FONT.medium,
      fontSize: 11,
      letterSpacing: 0.8,
    },
    recordAt: {
      color: t.dim,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 13,
    },
    recordPending: {
      color: t.dim,
      fontFamily: FONT.medium,
      fontSize: 12,
    },
    emptyRow: {
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    emptyText: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 14,
      textAlign: 'center',
    },
    footer: {gap: 10, paddingBottom: 4, marginTop: 'auto'},
    note: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 13,
      textAlign: 'center',
    },
  });

function timeOf(at: number): string {
  return new Date(at).toISOString().slice(11, 19);
}

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
  /** CLOSE BATCH's confirm when pending rows exist (a note, not a block). */
  const [pendingConfirm, setPendingConfirm] = React.useState(false);

  const done = batch.done.filter(r => r.ok);
  const stopped = batch.done.filter(r => !r.ok);
  const pending = done.filter(r => r.pending);
  const text =
    `Batch record — ${done.length} of ${batch.count} programmed\n` +
    batch.done
      .map(
        r =>
          `${r.ok ? 'ok' : 'stopped'} ${r.id}${
            r.demo ? ` (demo: ${r.demo})` : ''
          }` +
          ` ${new Date(r.at).toISOString()}${
            r.pending ? ' record pending' : ''
          }`,
      )
      .join('\n');

  return (
    <Screen title={SUMMARY.title} onBack={onBack}>
      <View style={s.grow}>
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.stats}>
            <View style={s.stat}>
              <Text style={[s.statFigure, s.statFigureAccent]}>
                {done.length}
              </Text>
              <Text style={s.statLabel}>Programmed</Text>
            </View>
            <View style={s.stat}>
              <Text style={s.statFigure}>{stopped.length}</Text>
              <Text style={s.statLabel}>Stopped</Text>
            </View>
            <View style={s.stat}>
              <Text
                style={[
                  s.statFigure,
                  pending.length === 0 ? undefined : s.statFigureAccent,
                ]}>
                {pending.length}
              </Text>
              <Text style={s.statLabel}>Pending</Text>
            </View>
          </View>

          <View style={s.section}>
            <Text style={s.sectionHeader}>The record</Text>
            <View style={s.card}>
              {batch.done.length === 0 ? (
                <View style={s.emptyRow}>
                  <Text style={s.emptyText}>{'No cards this batch yet.'}</Text>
                </View>
              ) : (
                batch.done.map((r, i) => {
                  const dot = !r.ok
                    ? s.stateDotStopped
                    : r.pending
                    ? s.stateDotPending
                    : s.stateDot;
                  return (
                    <React.Fragment key={`${r.id}-${i}`}>
                      {i > 0 ? <View style={s.divider} /> : null}
                      <View style={s.recordRow}>
                        <View style={dot} />
                        <Text style={s.recordId}>{`…${r.id}`}</Text>
                        {r.demo ? <Text style={s.recordDemo}>DEMO</Text> : null}
                        {r.ok && !r.pending ? (
                          <Text style={s.recordAt}>{timeOf(r.at)}</Text>
                        ) : null}
                        {!r.ok ? (
                          <Text style={s.recordAt}>{timeOf(r.at)}</Text>
                        ) : null}
                        {r.pending ? (
                          <Text style={s.recordPending}>{SUMMARY.pending}</Text>
                        ) : null}
                      </View>
                    </React.Fragment>
                  );
                })
              )}
            </View>
            {pending.length > 0 ? (
              <Text style={s.note}>{SUMMARY.pendingNote}</Text>
            ) : null}
          </View>
        </ScrollView>

        <View style={s.footer}>
          <PrimaryButton
            title={SUMMARY.share}
            testID="share-record"
            onPress={() => {
              Share.share({message: text}).catch(e =>
                setNote(describeShareFailure(e)),
              );
            }}
          />
          {note ? <Text style={s.note}>{note}</Text> : null}
          <SecondaryButton
            title="CLOSE BATCH"
            testID="close-batch"
            onPress={() => {
              // S4's retry contract: pending rows re-post; ending a batch
              // with pending rows says so plainly first — a confirm, not a
              // block. The second press closes.
              if (pending.length > 0 && !pendingConfirm) {
                setPendingConfirm(true);
                return;
              }
              app.endBatch();
              onClose();
            }}
          />
          {pendingConfirm ? (
            <Text style={s.note} testID="close-pending-note">
              {SUMMARY.pendingNote}
            </Text>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}
