import React, {useEffect, useState, useRef} from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Share,
} from 'react-native';
import {useProvisioning} from '../ProvisioningStore';
import {useApp} from '../store';
import {resetRecoveryDetails} from '../ownedResetWorkflow';

import {CardFigure} from '../CardFigure';
import {FONT, useTheme} from '../theme';
import {Dim, InfoButton, PrimaryButton, Screen, SecondaryButton} from '../ui';

const BLOCKED: Record<string, string> = {
  'operator-mismatch':
    'Sign in with the operator account that installed this card.',
  'independent-backup-stale':
    'Reset is paused until the service has a fresh independent backup. Ask your administrator to check backups.',
  'recovery-required':
    'The service is being recovered. Keep this card and ask your administrator when reset can continue.',
  'reset-unresolved':
    'This card already has a saved reset. Continue it on the original phone instead of starting another.',
};

export function ResetCardScreen({
  onBack,
  onInstall,
  backLabel = 'BACK TO SETTINGS',
}: {
  onBack: () => void;
  onInstall: () => void;
  backLabel?: string;
}) {
  const flow = useProvisioning(),
    app = useApp(),
    t = useTheme();
  const [erase, setErase] = useState(false),
    [valueHandled, setValueHandled] = useState(false),
    [pin, setPin] = useState('');
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const pinAccessoryId = React.useId();
  const leave = () => {
    flow.cancel();
    onBack();
  };
  const saved = flow.resetState;
  const visible =
    saved &&
    saved.journal.operator_id === app.session?.operator_id &&
    saved.journal.service_origin === app.serviceUrl &&
    saved.journal.key_env === app.session?.env
      ? saved
      : null;
  const pending = visible && visible.journal.stage !== 'complete';
  const previousReset = useRef(visible?.journal);
  const [completedId, setCompletedId] = useState<string | null>(null);
  useEffect(() => {
    const previous = previousReset.current;
    previousReset.current = visible?.journal;
    if (
      previous &&
      previous.stage !== 'complete' &&
      visible?.journal.stage === 'complete' &&
      previous.reset_id === visible.journal.reset_id
    ) {
      setCompletedId(visible.journal.reset_id);
    }
  }, [visible]);
  const showCompletion =
    visible?.journal.stage === 'complete' &&
    completedId === visible.journal.reset_id;
  const inspect = () => {
    setCompletedId(null);
    setShareNotice(null);
    return flow.inspectReset();
  };
  const card = pending ? visible.review : flow.resetReview?.card;
  const lookup = flow.resetReview?.source;
  const allowed =
    !!card &&
    card.unspent === 0 &&
    !card.locked &&
    !card.pinBlocked &&
    card.tag &&
    (card.spent === 0 ||
      (card.pin && card.sealed && card.record && card.mint.length > 0)) &&
    lookup?.can_reset === true &&
    lookup.lookup.status === 'found';
  useEffect(() => {
    setErase(false);
    setValueHandled(false);
    setPin('');
  }, [flow.resetReview, app.session?.token]);
  const dismissReview = useRef(flow.dismissResetReview);
  useEffect(() => () => dismissReview.current(), []); // Public review expires when leaving; durable work stays.
  const s = StyleSheet.create({
    scroll: {gap: 20, paddingBottom: 30},
    card: {padding: 18, borderRadius: 18, backgroundColor: t.card, gap: 12},
    text: {color: t.ink, fontFamily: FONT.regular, fontSize: 17},
    title: {color: t.ink, fontFamily: FONT.medium, fontSize: 23},
    check: {minHeight: 48, flexDirection: 'row', gap: 12, alignItems: 'center'},
    grow: {flex: 1},
    keyboardBar: {backgroundColor: t.card, alignItems: 'flex-end'},
    keyboardDone: {
      minHeight: 44,
      minWidth: 72,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    figure: {alignItems: 'center'},
    pin: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: t.dim,
      borderRadius: 12,
      padding: 12,
      color: t.ink,
      fontFamily: FONT.regular,
      fontSize: 18,
    },
  });
  const checkbox = (
    id: string,
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
  ) => (
    <Pressable
      testID={id}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{checked, disabled: flow.busy}}
      disabled={flow.busy}
      onPress={() => onChange(!checked)}
      style={s.check}>
      <Text style={s.text}>{checked ? '☑' : '☐'}</Text>
      <Text style={[s.text, s.grow]}>{label}</Text>
    </Pressable>
  );
  return (
    <Screen
      title="Reset a card"
      onBack={leave}
      headerRight={
        <InfoButton title="Resetting a card" testID="reset-help">
          {
            'Reset removes the wallet link, PIN, settings and applet. It is available for eligible cards installed by this service. First recover all value and finish pending payments and change in the holder wallet. A fresh installation creates a new card identity.'
          }
        </InfoButton>
      }
      onStop={flow.busy ? flow.cancel : undefined}>
      <ScrollView
        contentContainerStyle={s.scroll}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled">
        {pending && visible.journal.stage !== 'factory_verified' ? (
          <Dim>
            Reset removes this card’s wallet link, PIN, settings and applet.
          </Dim>
        ) : null}
        {flow.status !== 'ready' ? (
          <>
            <Dim>{flow.notice ?? 'Loading saved work…'}</Dim>
            <SecondaryButton
              title="RELOAD SAVED WORK"
              onPress={flow.reload}
              disabled={flow.busy}
            />
          </>
        ) : !flow.scopeMatches ? (
          <Dim>
            Sign in with the original operator account and service to continue
            the saved reset. Its details remain on this phone.
          </Dim>
        ) : flow.snapshot?.batch ? (
          <>
            <Text style={s.title}>Finish the current batch first</Text>
            <Dim>
              Resolve its current card, then close or end the batch before
              resetting another card.
            </Dim>
            <SecondaryButton title="RETURN TO BATCH" onPress={onInstall} />
          </>
        ) : (
          <>
            <View style={s.figure}>
              <CardFigure
                fill={showCompletion && !card ? 1 : 0}
                state={
                  flow.busy
                    ? 'running'
                    : showCompletion && !card
                    ? 'done'
                    : 'idle'
                }
              />
            </View>
            {card ? (
              <View style={s.card}>
                <Text style={s.title}>
                  {card.unspent > 0
                    ? 'Move the balance first'
                    : card.locked || card.pinBlocked
                    ? 'Holder recovery needed'
                    : card.spent > 0
                    ? 'Settlement check needed'
                    : 'Empty card'}
                </Text>
                <Text selectable style={s.text}>
                  {card.chipId}
                </Text>
                <Dim>{`Card key …${card.installationId.slice(-8)} · ${
                  card.unspent
                } unspent · ${card.spent} retained spent entries`}</Dim>
                {card.spent > 0 ? (
                  <Dim>{`Settlement check: ${
                    card.mint || 'unsupported mint address'
                  }. Only derived proof identifiers go to this mint; the PIN is sent only to the card, encrypted.`}</Dim>
                ) : null}
                {card.unspent > 0 ? (
                  <Dim>
                    Use the holder wallet to spend or recover all value. This
                    app will not erase a card with unspent entries.
                  </Dim>
                ) : null}
                {card.locked || card.pinBlocked ? (
                  <Dim>
                    Unlock or recover the PIN in the holder wallet before
                    resetting.
                  </Dim>
                ) : null}
                {!card.tag ? (
                  <Dim>
                    The installation is incomplete. Keep this card for
                    administrator review.
                  </Dim>
                ) : null}
                {lookup && !lookup.can_reset ? (
                  <Dim>
                    {BLOCKED[lookup.blocked_reason ?? ''] ??
                      (lookup.lookup.status === 'unresolved'
                        ? 'This card has unfinished installation history. Share its support details with your administrator.'
                        : lookup.lookup.status === 'found'
                        ? 'Reset is unavailable for this account or service. Ask your administrator to check this card’s installation history.'
                        : 'This service cannot confirm the card’s current manager keys. Use the original provisioning service or ask its administrator for recovery.')}
                  </Dim>
                ) : null}
              </View>
            ) : null}
            {pending ? (
              <>
                <Text style={s.title}>
                  {visible.journal.stage === 'factory_verified'
                    ? 'Save reset completion'
                    : visible.review.spent > 0
                    ? 'Clear settled entries'
                    : 'Ready to reset this card'}
                </Text>
                <Dim>
                  {visible.journal.stage === 'factory_verified'
                    ? 'The card was reset. Only the service confirmation remains; no card tap is needed.'
                    : visible.review.spent > 0
                    ? 'The mint must confirm every retained entry spent. Enter the current card PIN privately, then hold this same card still. Pending payments stop cleanup.'
                    : 'Hold this same card still. The app will inspect saved progress before continuing; it will not start a new reset.'}
                </Dim>
                {visible.review.spent > 0 ? (
                  <TextInput
                    inputAccessoryViewID={
                      Platform.OS === 'ios' ? pinAccessoryId : undefined
                    }
                    testID="reset-pin"
                    accessibilityLabel="Current card PIN"
                    placeholder="Current card PIN"
                    placeholderTextColor={t.dim}
                    secureTextEntry
                    keyboardType="number-pad"
                    maxLength={8}
                    autoCorrect={false}
                    autoComplete="off"
                    textContentType="none"
                    value={pin}
                    editable={!flow.busy}
                    style={s.pin}
                    onChangeText={v => setPin(v.replace(/[^0-9]/g, ''))}
                  />
                ) : null}
                <PrimaryButton
                  testID="reset-continue"
                  title={
                    flow.busy
                      ? 'WORKING…'
                      : visible.journal.stage === 'factory_verified'
                      ? 'SAVE RESET COMPLETION'
                      : visible.review.spent > 0
                      ? 'CHECK SETTLEMENT AND CLEAR ENTRIES'
                      : 'RESET THIS CARD'
                  }
                  danger={visible.journal.stage !== 'factory_verified'}
                  disabled={
                    flow.busy ||
                    !flow.hardwareValidated ||
                    (visible.review.spent > 0 && !/^[0-9]{4,8}$/.test(pin))
                  }
                  onPress={() => {
                    const entered = pin;
                    setPin('');
                    flow.continueReset(entered);
                  }}
                />
              </>
            ) : card ? (
              <>
                {allowed ? (
                  <View style={s.card}>
                    {checkbox(
                      'reset-consent-erase',
                      'I approve removing this card’s wallet link, PIN, settings and old applet.',
                      erase,
                      setErase,
                    )}
                    {checkbox(
                      'reset-consent-value',
                      'I have recovered the balance and finished pending payments and change.',
                      valueHandled,
                      setValueHandled,
                    )}
                    <PrimaryButton
                      title="PREPARE THIS CARD FOR RESET"
                      testID="reset-prepare"
                      danger
                      disabled={
                        flow.busy ||
                        !erase ||
                        !valueHandled ||
                        !flow.hardwareValidated
                      }
                      onPress={() => flow.prepareReset({erase, valueHandled})}
                    />
                  </View>
                ) : null}
                <SecondaryButton
                  title="CHECK A CARD AGAIN"
                  testID="reset-inspect"
                  onPress={inspect}
                  disabled={flow.busy}
                />
              </>
            ) : showCompletion ? (
              <>
                <Text style={s.title}>Reset complete</Text>
                <Dim>
                  Reset saved. Install this card again, then set it up in a
                  holder wallet.
                </Dim>
                <PrimaryButton
                  title="SET UP A NEW BATCH"
                  testID="reset-install"
                  onPress={onInstall}
                />
                <SecondaryButton
                  title="CHECK ANOTHER CARD"
                  testID="reset-inspect"
                  onPress={inspect}
                  disabled={flow.busy}
                />
              </>
            ) : (
              <PrimaryButton
                title={flow.busy ? 'WAITING FOR CARD…' : 'CHECK CARD FOR RESET'}
                testID="reset-inspect"
                onPress={inspect}
                disabled={flow.busy}
              />
            )}
            {pending && !flow.busy ? (
              <Dim>
                Saved work stays on this phone when you leave. Keep this card
                aside until you continue.
              </Dim>
            ) : null}
            {flow.phase ? (
              <Text style={s.text} accessibilityLiveRegion="polite">
                {flow.phase}
              </Text>
            ) : null}
            {visible ? (
              <SecondaryButton
                title={
                  pending || showCompletion
                    ? 'SHARE RESET DETAILS'
                    : 'SHARE LAST RESET DETAILS'
                }
                testID="reset-share"
                disabled={flow.busy}
                onPress={async () => {
                  try {
                    await Share.share({message: resetRecoveryDetails(visible)});
                    setShareNotice(null);
                  } catch {
                    setShareNotice(
                      'Sharing did not open. Keep this phone and ask your administrator for help.',
                    );
                  }
                }}
              />
            ) : null}
            {shareNotice ? <Dim>{shareNotice}</Dim> : null}
            {flow.notice ? (
              <Text style={s.text} accessibilityLiveRegion="polite">
                {flow.notice}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
      {Platform.OS === 'ios' && pending && visible.review.spent > 0 ? (
        <InputAccessoryView nativeID={pinAccessoryId}>
          <View style={s.keyboardBar}>
            <Pressable
              style={s.keyboardDone}
              accessibilityRole="button"
              accessibilityLabel="Done entering PIN"
              testID="reset-pin-done"
              onPress={Keyboard.dismiss}>
              <Text style={s.text}>Done</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
      {flow.busy ? (
        <SecondaryButton
          title={flow.cardActive ? 'CANCEL TAP' : 'STOP AND KEEP SAVED WORK'}
          testID="reset-cancel"
          onPress={flow.cancel}
        />
      ) : (
        <SecondaryButton
          title={
            pending
              ? 'STOP AND SAVE FOR LATER'
              : card
              ? 'CANCEL REVIEW'
              : backLabel
          }
          testID="reset-leave"
          onPress={leave}
        />
      )}
    </Screen>
  );
}
