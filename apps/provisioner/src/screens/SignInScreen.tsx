/**
 * S1. Sign-in, real (ENG-740): the button POSTs /auth/operator/session; a
 * failure renders the service's own reason in SIGNIN.failed(reason) and the
 * button retries on press. The stub's "admits any build" line is gone — the
 * ops service exists. Below the form sits demo's design-review door: demo
 * mode with no session at all, so the screens run without a service
 * (PROVISIONER-APP "Demo mode" — review on a phone before/without one).
 *
 * The design tier of the other screens: the wordmark as the screen's headline
 * with the load sha as its small print, the tagline centered, and the action
 * plus its honest note in a footer so the whole screen reads as one block —
 * nothing floats mid-air.
 */
import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';

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
    form: {
      alignSelf: 'stretch',
      gap: 10,
      paddingHorizontal: 8,
    },
    input: {
      color: t.ink,
      fontFamily: FONT.regular,
      fontSize: 16,
      borderWidth: 1.5,
      borderColor: t.line,
      borderRadius: 12,
      backgroundColor: t.card,
      paddingHorizontal: 14,
      paddingVertical: 12,
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
    demoLink: {
      color: t.dim,
      fontFamily: FONT.medium,
      fontSize: 14,
      textAlign: 'center',
    },
  });

export function SignInScreen() {
  const app = useApp();
  const t = useTheme();
  const s = local(t);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const attempt = async () => {
    if (busy || name.trim() === '' || password === '') {
      return;
    }
    setBusy(true);
    setFailed(null);
    try {
      // The operator's name and password are typed here and held in memory
      // only: the password is the operator's one secret, never stored by the
      // app (the service keeps its scrypt hash).
      await app.signIn(name.trim(), password);
    } catch (e) {
      setFailed(
        e instanceof ApiUnreachableError
          ? SIGNIN.failed(SIGNIN.unreachable)
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
        <View style={s.form}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={SIGNIN.namePlaceholder}
            placeholderTextColor={t.dim}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            style={s.input}
            testID="sign-in-name"
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder={SIGNIN.passwordPlaceholder}
            placeholderTextColor={t.dim}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            editable={!busy}
            style={s.input}
            testID="sign-in-password"
          />
        </View>
      </View>
      <View style={s.footer}>
        <PrimaryButton
          title={busy ? SIGNIN.signingIn : SIGNIN.button}
          onPress={() => attempt()}
          disabled={busy || name.trim() === '' || password === ''}
          testID="sign-in"
        />
        {failed ? (
          <Text style={s.failed} testID="sign-in-failed">
            {failed}
          </Text>
        ) : (
          <Text style={s.note}>{SIGNIN.note}</Text>
        )}
        {/* Demo's design-review door (PROVISIONER-APP "Demo mode"): the
            screens run against the fake card with no session at all — the
            store holds demo with session null, and the batch screen falls
            back to its own mints. No service needed. */}
        <Pressable
          onPress={() => app.setDemo(true)}
          disabled={busy}
          testID="demo-entry">
          <Text style={s.demoLink}>{SIGNIN.demo}</Text>
          <Text style={s.note}>{SIGNIN.demoSub}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

/** The load set this build makes, the same pin the batch screen states. */
const SIGNIN_BUILD = 'Builds the 2.1 card · Load file fe7d8ac3…';
