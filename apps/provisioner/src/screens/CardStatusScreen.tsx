import React, {useEffect, useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useProvisioning} from '../ProvisioningStore';
import {cardStatus} from '../cardStatus';
import {CardFigure} from '../CardFigure';
import {FONT, useTheme} from '../theme';
import {Dim, PrimaryButton, Screen, SecondaryButton} from '../ui';

export function CardStatusScreen({
  onBack,
  onInstall,
  onReset,
}: {
  onBack: () => void;
  onInstall: () => void;
  onReset: () => void;
}) {
  const flow = useProvisioning(),
    t = useTheme();
  const [holderHelp, setHolderHelp] = useState(false);
  const dismiss = useRef(flow.dismissCardReadout);
  useEffect(() => () => dismiss.current(), []);
  const value = flow.cardReadout;
  const summary = value
    ? cardStatus(value.readout, {
        source: value.source,
        savedChip: flow.snapshot?.active?.journal?.chip_id,
        savedStage: flow.snapshot?.active?.journal?.stage,
      })
    : null;
  const card = value?.readout.state === 'present' ? value.readout.card : null;
  const pendingReset =
    flow.resetState?.journal.stage !== 'complete' && !!flow.resetState;
  const s = StyleSheet.create({
    scroll: {gap: 20, paddingBottom: 30},
    figure: {alignItems: 'center'},
    box: {padding: 18, borderRadius: 18, backgroundColor: t.card, gap: 12},
    title: {fontFamily: FONT.medium, fontSize: 24, color: t.ink},
    text: {fontFamily: FONT.regular, fontSize: 16, color: t.ink},
  });
  return (
    <Screen
      title="Check a card"
      onBack={onBack}
      onStop={flow.busy ? flow.cancel : undefined}
      physicalReadOnly>
      <ScrollView contentContainerStyle={s.scroll}>
        <Dim>
          Read identity, installation and public card state. This check does not
          authenticate, change keys, clear entries or spend value.
        </Dim>
        {!flow.scopeMatches ? (
          <Dim>
            Saved work belongs to another account or service. Sign in with its
            original operator account before continuing.
          </Dim>
        ) : null}
        <View style={s.figure}>
          <CardFigure
            fill={value ? 1 : 0}
            state={flow.busy ? 'running' : value ? 'done' : 'idle'}
          />
        </View>
        {summary && value ? (
          <View style={s.box}>
            <Text
              style={s.title}
              testID="card-status-title"
              accessibilityLiveRegion="polite">
              {summary.title}
            </Text>
            <Dim>{summary.detail}</Dim>
            <Text selectable style={s.text}>
              {value.readout.chipId}
            </Text>
            {card ? (
              <>
                <Dim>{`Card key …${card.installationId.slice(-8)}`}</Dim>
                <Dim>{`${card.unspent} unspent · ${card.spent} retained spent entries`}</Dim>
              </>
            ) : null}
            <PrimaryButton
              title={summary.label}
              testID="card-status-action"
              disabled={flow.busy}
              onPress={() => {
                if (summary.action === 'holder') {
                  setHolderHelp(true);
                } else if (summary.action === 'admin') {
                  onBack();
                } else {
                  onInstall();
                }
              }}
            />
            {holderHelp ? (
              <Dim>
                Open Cards in a compatible Cashu wallet and read this same card.
                Use that wallet for holder setup, balance, loading, PIN recovery
                and pending change. Keep its recovery backup verified; never
                enter the recovery phrase in this provisioner.
              </Dim>
            ) : null}
            {card?.unspent === 0 &&
            !card.locked &&
            !card.pinBlocked &&
            card.tag &&
            value.source?.can_reset === true &&
            !flow.snapshot?.batch &&
            !pendingReset ? (
              <SecondaryButton
                title="REVIEW RESET FOR REUSE"
                testID="card-status-reset"
                onPress={onReset}
                disabled={flow.busy}
              />
            ) : null}
          </View>
        ) : null}
        {pendingReset ? (
          <SecondaryButton
            title="CONTINUE SAVED RESET"
            onPress={onReset}
            disabled={flow.busy}
          />
        ) : null}
        {flow.notice ? (
          <Text style={s.text} accessibilityLiveRegion="polite">
            {flow.notice}
          </Text>
        ) : null}
        <PrimaryButton
          title={
            flow.busy
              ? 'READING CARD…'
              : value
              ? 'CHECK CARD AGAIN'
              : 'READ CARD STATUS'
          }
          testID="card-status-read"
          disabled={flow.busy || flow.status !== 'ready' || !flow.scopeMatches}
          onPress={() => {
            setHolderHelp(false);
            flow.inspectStatus();
          }}
        />
      </ScrollView>
      {flow.busy ? (
        <SecondaryButton title="CANCEL READ" onPress={flow.cancel} />
      ) : null}
    </Screen>
  );
}
