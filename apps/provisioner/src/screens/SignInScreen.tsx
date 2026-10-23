/** Operator sign-in. Keep the action above the keyboard and the form scrollable. */
import React, {useRef, useState} from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {ApiUnreachableError} from '../api';
import {CASHU_LOAD_FILE} from '../assets/cashu';
import {APP_NAME, SIGNIN} from '../strings';
import {useApp} from '../store';
import {LegalLinks} from '../LegalLinks';
import {FONT, useTheme, type Theme} from '../theme';
import {PrimaryButton, Screen} from '../ui';

const local = (t: Theme) =>
  StyleSheet.create({
    grow: {flex: 1},
    center: {
      flexGrow: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 24,
      paddingVertical: 16,
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
  });

export function SignInScreen() {
  const app = useApp();
  const t = useTheme();
  const s = local(t);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordInput = useRef<TextInput>(null);

  const attempt = async () => {
    if (busy || name.trim() === '' || password === '') {
      return;
    }
    Keyboard.dismiss();
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
    <KeyboardAvoidingView
      style={s.grow}
      enabled={Platform.OS === 'ios'}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <ScrollView
          style={s.grow}
          contentContainerStyle={s.center}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
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
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => passwordInput.current?.focus()}
              autoComplete="username"
              textContentType="username"
              accessibilityLabel="Operator name"
              testID="sign-in-name"
            />
            <TextInput
              ref={passwordInput}
              value={password}
              onChangeText={setPassword}
              placeholder={SIGNIN.passwordPlaceholder}
              placeholderTextColor={t.dim}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              editable={!busy}
              style={s.input}
              returnKeyType="go"
              onSubmitEditing={attempt}
              autoComplete="current-password"
              textContentType="password"
              accessibilityLabel="Password"
              testID="sign-in-password"
            />
          </View>
          <LegalLinks />
        </ScrollView>
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
            <Text style={s.note} accessibilityLiveRegion="polite">
              {busy
                ? 'Checking your account… Keep this screen open.'
                : SIGNIN.note}
            </Text>
          )}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

/** The load set this build makes, the same pin the batch screen states. */
const SIGNIN_BUILD = `Builds the 2.1 card · Load file ${CASHU_LOAD_FILE.sha256.slice(
  0,
  8,
)}…`;
