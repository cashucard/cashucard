/**
 * S1. Sign-in. The stub stands until the ops service (Phase 3) issues real
 * operator sessions; the button admits any build and says so, per the design.
 *
 * The design tier of the other screens: the wordmark as the screen's headline
 * with the load sha as its small print, the tagline centered, and the action
 * plus its honest note in a footer so the whole screen reads as one block —
 * nothing floats mid-air.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

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
  });

export function SignInScreen() {
  const app = useApp();
  const t = useTheme();
  const s = local(t);
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
        <PrimaryButton title={SIGNIN.button} onPress={app.signIn} testID="sign-in" />
        <Text style={s.note}>
          {'While the key service is pending, sign-in admits this build.'}
        </Text>
      </View>
    </Screen>
  );
}

/** The load set this build makes, the same pin the batch screen states. */
const SIGNIN_BUILD = 'Builds the 2.1 card · Load file fe7d8ac3…';
