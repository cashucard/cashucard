/**
 * The designed app (ENG-739, docs/PROVISIONER-APP.md): sign-in, batch setup,
 * the loop, the summary and settings, plus the bench screen kept at
 * Settings → Bench runs for the real-hardware path. Navigation here is a
 * route switch — the real navigation stack lands with the build phase.
 *
 * The sign-in gate is back (ENG-740): the ops service issues real operator
 * sessions, and a signed-in session's env is what the batch runs on. Demo
 * mode stays reachable for design review without a service — from the
 * sign-in screen's demo door (no session at all; the store holds demo with
 * session null) and from Settings once signed in.
 */
import React, {useState} from 'react';
import {Text, View} from 'react-native';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';

import {BatchSetupScreen} from './src/screens/BatchSetupScreen';
import {BatchSummaryScreen} from './src/screens/BatchSummaryScreen';
import {LoadTestScreen} from './src/screens/LoadTestScreen';
import {LoopScreen} from './src/screens/LoopScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {SignInScreen} from './src/screens/SignInScreen';
import {AppStore, useApp} from './src/store';
import {
  ProvisioningProvider,
  useProvisioning,
  type ProvisioningProviderOptions,
} from './src/ProvisioningStore';
import {CardIdentityScreen} from './src/screens/CardIdentityScreen';
import {ProvisioningScreen} from './src/screens/ProvisioningScreen';
import {BENCH_RUNS_ENABLED} from './src/releaseGates';

type Route = 'setup' | 'loop' | 'summary' | 'settings' | 'bench' | 'identity';

const benchStyles = {
  benchWrap: {flex: 1} as const,
  benchBack: {padding: 16} as const,
};

function Navigator(): React.JSX.Element {
  const app = useApp();
  const recovery = useProvisioning();
  const [route, setRoute] = useState<Route>('setup');

  if (!app.signedIn && !app.demo) {
    // Demo is its own door past the gate: demo mode runs every screen with
    // no session at all (the batch screen falls back to its own mints; the
    // loop and the summary never read the session), so a reviewer reaches it
    // from the sign-in screen without a service.
    return <SignInScreen />;
  }

  if (!app.demo && !['settings', 'bench', 'identity'].includes(route)) {
    return <ProvisioningScreen onSettings={() => setRoute('settings')} />;
  }

  // A stale/direct route cannot mount laboratory write controls in this build.
  const visibleRoute =
    route === 'bench' && !BENCH_RUNS_ENABLED ? 'settings' : route;
  switch (visibleRoute) {
    case 'settings':
      return (
        <SettingsScreen
          onBack={() => setRoute('setup')}
          onBench={() => {
            if (BENCH_RUNS_ENABLED && !recovery.busy) {
              setRoute('bench');
            }
          }}
          onIdentity={() => {
            if (!recovery.busy) {
              setRoute('identity');
            }
          }}
          hardwareBusy={recovery.busy}
          hasSavedBatch={!!recovery.snapshot?.batch}
        />
      );
    case 'identity':
      return (
        <CardIdentityScreen
          onBack={() => setRoute('settings')}
          disabled={recovery.busy}
        />
      );
    case 'bench':
      return (
        // Approved laboratory builds only; the handler also enforces the gate.
        <View style={benchStyles.benchWrap}>
          <Text
            onPress={() => setRoute('settings')}
            style={benchStyles.benchBack}>
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

export default function App({
  recovery,
}: {recovery?: ProvisioningProviderOptions} = {}): React.JSX.Element {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AppStore>
        <ProvisioningProvider options={recovery}>
          <Navigator />
        </ProvisioningProvider>
      </AppStore>
    </SafeAreaProvider>
  );
}
