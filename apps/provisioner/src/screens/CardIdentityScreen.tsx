/** Explicit read-only hardware check, separate from provisioning and demo. */
import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {readChipIdentity} from '../cardkit';
import {createCardSession, type SessionMeta} from '../session';
import {FONT, useTheme} from '../theme';
import {Dim, PrimaryButton, Screen, SecondaryButton} from '../ui';

export function CardIdentityScreen({
  onBack,
  disabled = false,
}: {
  onBack: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const session = useRef<ReturnType<typeof createCardSession> | null>(null);
  const mounted = useRef(true);
  const running = useRef(false);
  const cancelled = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<{id: string; meta: SessionMeta} | null>(
    null,
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelled.current = true;
      session.current?.cancel();
    };
  }, []);
  const read = async () => {
    if (running.current || disabled) {
      return;
    }
    running.current = true;
    cancelled.current = false;
    setBusy(true);
    setResult(null);
    setNotice(null);
    session.current ??= createCardSession();
    try {
      const readout = await session.current.run(
        'Read card identity only. Hold the physical card near the phone.',
        readChipIdentity,
      );
      if (mounted.current && !cancelled.current) {
        setResult({id: readout.value.id, meta: readout.meta});
      }
    } catch {
      if (mounted.current && !cancelled.current) {
        setNotice(
          'Card identity could not be read. Remove the card and retry deliberately.',
        );
      }
    } finally {
      running.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  };
  const s = StyleSheet.create({
    content: {gap: 20},
    text: {fontFamily: FONT.regular, fontSize: 16, color: t.ink},
  });
  return (
    <Screen title="Card identity check" onBack={onBack}>
      <View style={s.content}>
        <Dim>
          This reads a physical card, including in demo mode. It reads public
          CPLC identity only: no authentication, installation or service
          request.
        </Dim>
        <PrimaryButton
          title={
            busy ? 'WAITING FOR CARD IDENTITY…' : 'READ PHYSICAL CARD IDENTITY'
          }
          testID="identity-read"
          disabled={busy || disabled}
          onPress={read}
        />
        {busy ? (
          <SecondaryButton
            title="CANCEL READ"
            testID="identity-cancel"
            onPress={() => {
              cancelled.current = true;
              setNotice('Identity read cancelled.');
              session.current?.cancel();
            }}
          />
        ) : null}
        {notice ? (
          <Text style={s.text} testID="identity-notice">
            {notice}
          </Text>
        ) : null}
        {result ? (
          <>
            <Text selectable style={s.text} testID="identity-result">
              {result.id}
            </Text>
            <Text selectable style={s.text}>
              {result.meta.platform} · {result.meta.os}
            </Text>
            <Dim>
              Public CPLC is not proof of ownership or global uniqueness. This
              result does not enable installation or certify holder readiness.
            </Dim>
          </>
        ) : null}
      </View>
    </Screen>
  );
}
