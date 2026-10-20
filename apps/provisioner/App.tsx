/**
 * The designed app (ENG-739, docs/PROVISIONER-APP.md): batch setup, the
 * loop, the summary and settings, plus the bench screen kept at
 * Settings → Bench runs for the real-hardware path. Navigation here is a
 * four-route switch — the real navigation stack lands with the build phase.
 *
 * The sign-in gate is removed until the ops service (Phase 3) issues real
 * operator sessions; SignInScreen stays in the tree for that day. The
 * store's signedIn stub is untouched.
 */
import React, {useState} from 'react';
import {Text, View} from 'react-native';

import {BatchSetupScreen} from './src/screens/BatchSetupScreen';
import {BatchSummaryScreen} from './src/screens/BatchSummaryScreen';
import {LoadTestScreen} from './src/screens/LoadTestScreen';
import {LoopScreen} from './src/screens/LoopScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {AppStore, useApp} from './src/store';

type Route = 'setup' | 'loop' | 'summary' | 'settings' | 'bench';

const benchStyles = {
  benchWrap: {flex: 1} as const,
  benchBack: {padding: 16} as const,
};

function Navigator(): React.JSX.Element {
  const app = useApp();
  const [route, setRoute] = useState<Route>('setup');

  switch (route) {
    case 'settings':
      return (
        <SettingsScreen
          onBack={() => setRoute('setup')}
          onBench={() => setRoute('bench')}
        />
      );
    case 'bench':
      return (
        // the ENG-738 spike screen, unchanged, at Settings → Bench runs
        <View style={benchStyles.benchWrap}>
          <Text onPress={() => setRoute('settings')} style={benchStyles.benchBack}>
            ‹ Back
          </Text>
          <LoadTestScreen />
        </View>
      );
    case 'loop':
      return <LoopScreen onEndBatch={() => setRoute('summary')} />;
    case 'summary':
      return (
        <BatchSummaryScreen
          onBack={() => setRoute('loop')}
          onClose={() => setRoute('setup')}
        />
      );
    default:
      return app.batch ? (
        <LoopScreen onEndBatch={() => setRoute('summary')} />
      ) : (
        <BatchSetupScreen
          onStart={() => setRoute('loop')}
          onSettings={() => setRoute('settings')}
        />
      );
  }
}

export default function App(): React.JSX.Element {
  return (
    <AppStore>
      <Navigator />
    </AppStore>
  );
}
