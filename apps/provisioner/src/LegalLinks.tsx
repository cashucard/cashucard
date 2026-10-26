import React from 'react';
import {Alert, Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {FONT, useTheme} from './theme';
import {useApp} from './store';

export const OPS_DASHBOARD_URL = 'https://ops.cashucard.org';

/** This display alias leaves API requests and saved-work origins intact. */
export function opsDashboardUrl(
  serviceOrigin: string | undefined,
): string | null {
  if (serviceOrigin === 'https://cashu-card-ops.old-cell-30e7.workers.dev') {
    return OPS_DASHBOARD_URL;
  }
  return typeof serviceOrigin === 'string' &&
    /^https?:\/\/[^\s/?#@]+\/?$/.test(serviceOrigin)
    ? serviceOrigin.replace(/\/$/, '')
    : null;
}

export function OpsDashboardLink({
  testID,
  textTestID,
}: {
  testID: string;
  textTestID?: string;
}) {
  const t = useTheme();
  const url = opsDashboardUrl(useApp().serviceUrl);
  const s = StyleSheet.create({
    link: {minHeight: 44, justifyContent: 'center', flexShrink: 1},
    label: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 14,
      textDecorationLine: 'underline',
    },
  });
  if (!url) {
    return null;
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel="Open ops dashboard"
      style={s.link}
      onPress={async () => {
        try {
          await Linking.openURL(url);
        } catch {
          Alert.alert(
            'Unable to open dashboard',
            `Open ${url} in your browser.`,
          );
        }
      }}>
      <Text testID={textTestID} style={s.label}>
        {url}
      </Text>
    </Pressable>
  );
}

const links = [
  {
    id: 'privacy',
    label: 'Privacy Policy',
    url: 'https://getflash.io/legal/privacy.html',
  },
  {id: 'terms', label: 'Terms', url: 'https://getflash.io/legal/terms.html'},
  {id: 'support', label: 'Support', url: 'mailto:support@getflash.io'},
] as const;

export function LegalLinks() {
  const theme = useTheme();
  return (
    <View style={styles.links}>
      {links.map(link => (
        <Pressable
          key={link.id}
          accessibilityRole="link"
          testID={`legal-${link.id}`}
          style={styles.link}
          onPress={async () => {
            try {
              await Linking.openURL(link.url);
            } catch {
              Alert.alert(
                'Unable to open link',
                link.id === 'support'
                  ? 'Email support@getflash.io from your preferred email app.'
                  : 'Please try again later.',
              );
            }
          }}>
          <Text style={[styles.label, {color: theme.dim}]}>{link.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  links: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center'},
  link: {paddingHorizontal: 12, minHeight: 44, justifyContent: 'center'},
  label: {
    fontFamily: FONT.regular,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});
