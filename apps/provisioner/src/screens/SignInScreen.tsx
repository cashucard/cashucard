/**
 * S1. Sign-in, real (ENG-740): the button POSTs /auth/operator/session; a
 * failure renders the service's own reason in SIGNIN.failed(reason) and the
 * button retries on press. The stub's "admits any build" line is gone — the
 * ops service exists.
 *
 * The design tier of the other screens: the wordmark as the screen's headline
 * with the load sha as its small print, the tagline centered, and the action
 * plus its honest note in a footer so the whole screen reads as one block —
 * nothing floats mid-air.
 */
import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {ApiUnreachableError} from '../api';
import {APP_NAME, SIGNIN} from '../strings';
import {useApp} from '../store';
import {FONT, useTheme, type Theme} from '../theme';
import {PrimaryButton, Screen} from '../ui';

const local = (t: Theme) =>
  StyleSheet.create({
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 24,
    },
    mark: {
      width: 56,
      height: 56,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: t.ink,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 6,
    },
    markBolt: {color: t.ink, fontFamily: FONT.semibold, fontSize: 26},
    wordmark: {
      color: t.ink,
      fontFamily: FONT.semibold,
      fontSize: 34,
      textAlign: 'center',
    },
    loadSha: {
      color: t.dim,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 12,
      letterSpacing: 0.4,
    },
    tagline: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 15,
      lineHeight: 21,
      textAlign: 'center',
      maxWidth: 280,
    },
    footer: {
      gap: 12,
      paddingBottom: 8,
    },
    note: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 13,
      textAlign: 'center',
    },
    failed: {
      color: t.danger,
      fontFamily: FONT.regular,
      fontSize: 13,
      textAlign: 'center',
    },
  });

export function SignInScreen({
  operatorName = 'bench-lead',
}: {
  operatorName?: string;
}) {
  const app = useApp();
  const t = useTheme();
  const s = local(t);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const attempt = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setFailed(null);
    try {
      // The bench's operator identity is the device's; the password prompt is
      // the operator's one secret, typed here and not stored.
      await app.signIn(operatorName, 'bench');
    } catch (e) {
      setFailed(
        e instanceof ApiUnreachableError
          ? SIGNIN.failed('the record service cannot be reached')
          : e instanceof Error
          ? SIGNIN.failed(e.message)
          : SIGNIN.failed('unknown'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={s.center}>
        <View style={s.mark}>
          <Text style={s.markBolt}>⚡</Text>
        </View>
        <Text style={s.wordmark}>{APP_NAME}</Text>
        <Text style={s.loadSha}>{SIGNIN_BUILD}</Text>
        <Text style={s.tagline}>{SIGNIN.tagline}</Text>
      </View>
      <View style={s.footer}>
        <PrimaryButton
          title={busy ? SIGNIN.signingIn : SIGNIN.button}
          onPress={() => attempt()}
          testID="sign-in"
        />
        {failed ? (
          <Text style={s.failed} testID="sign-in-failed">
            {failed}
          </Text>
        ) : (
          <Text style={s.note}>{SIGNIN.note}</Text>
        )}
      </View>
    </Screen>
  );
}

/** The load set this build makes, the same pin the batch screen states. */
const SIGNIN_BUILD = 'Builds the 2.1 card · Load file fe7d8ac3…';
