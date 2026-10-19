/**
 * S1. Sign-in. The stub stands until the ops service (Phase 3) issues real
 * operator sessions; the button admits any build and says so, per the design.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {APP_NAME, SIGNIN} from '../strings';
import {useApp} from '../store';
import {FONT, useTheme, type Theme} from '../theme';
import {Dim, PrimaryButton, Screen} from '../ui';

const local = (t: Theme) =>
  StyleSheet.create({
    center: {flex: 1, justifyContent: 'center', gap: 16},
    wordmark: {
      color: t.ink,
      fontFamily: FONT.semibold,
      fontSize: 34,
      textAlign: 'center',
    },
    tagline: {alignItems: 'center'},
  });

export function SignInScreen() {
  const app = useApp();
  const t = useTheme();
  const s = local(t);
  return (
    <Screen>
      <View style={s.center}>
        <Text style={s.wordmark}>{APP_NAME}</Text>
        <View style={s.tagline}>
          <Dim>{SIGNIN.tagline}</Dim>
        </View>
        <PrimaryButton title={SIGNIN.button} onPress={app.signIn} />
        <Dim>
          {'While the key service is pending, sign-in admits this build.'}
        </Dim>
      </View>
    </Screen>
  );
}
