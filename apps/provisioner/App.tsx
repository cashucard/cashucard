/** Authenticated operator routes; saved provisioning work owns installation navigation. */
import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';

import {CardsHomeScreen} from './src/screens/CardsHomeScreen';
import {LoadTestScreen} from './src/screens/LoadTestScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {SignInScreen} from './src/screens/SignInScreen';
import {AppStore, useApp} from './src/store';
import {
  ProvisioningProvider,
  useProvisioning,
  type ProvisioningProviderOptions,
} from './src/ProvisioningStore';
import {CardIdentityScreen} from './src/screens/CardIdentityScreen';
import {ResetCardScreen} from './src/screens/ResetCardScreen';
import {CardStatusScreen} from './src/screens/CardStatusScreen';
import {ProvisioningScreen} from './src/screens/ProvisioningScreen';
import {BENCH_RUNS_ENABLED} from './src/releaseGates';

type Route =
  'home' | 'setup' | 'settings' | 'bench' | 'identity' | 'reset' | 'status';

const benchStyles = {
  benchWrap: {flex: 1} as const,
  benchBack: {padding: 16} as const,
};

function Navigator(): React.JSX.Element {
  const app = useApp();
  const recovery = useProvisioning();
  const [route, setRoute] = useState<Route>('home');
  useEffect(() => {
    setRoute('home');
  }, [
    app.session?.operator_id,
    app.session?.env,
    app.serviceUrl,
    app.signedIn,
  ]);

  if (!app.signedIn || !app.session) {
    return <SignInScreen />;
  }
  if (route === 'home') {
    return (
      <CardsHomeScreen
        onInstall={() => setRoute('setup')}
        onReset={() => setRoute('reset')}
        onSettings={() => setRoute('settings')}
      />
    );
  }
  if (route === 'setup') {
    return (
      <ProvisioningScreen
        onHome={() => setRoute('home')}
        onSettings={() => setRoute('settings')}
        onReset={() => setRoute('reset')}
        onCheck={() => setRoute('status')}
      />
    );
  }
  const visibleRoute =
    route === 'bench' && !BENCH_RUNS_ENABLED ? 'settings' : route;
  switch (visibleRoute) {
    case 'settings':
      return (
        <SettingsScreen
          onBack={() => setRoute('home')}
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
          onReset={
            app.session
              ? () => {
                  if (!recovery.busy) {
                    setRoute('reset');
                  }
                }
              : undefined
          }
          onStatus={
            app.session
              ? () => {
                  if (!recovery.busy) {
                    setRoute('status');
                  }
                }
              : undefined
          }
          hardwareBusy={recovery.busy}
          hasSavedBatch={
            !!recovery.snapshot?.batch ||
            (!!recovery.resetState &&
              recovery.resetState.journal.stage !== 'complete')
          }
        />
      );
    case 'identity':
      return (
        <CardIdentityScreen
          onBack={() => setRoute('settings')}
          disabled={recovery.busy}
        />
      );
    case 'reset':
      return (
        <ResetCardScreen
          onBack={() => setRoute('settings')}
          onInstall={() => setRoute('setup')}
        />
      );
    case 'status':
      return (
        <CardStatusScreen
          onBack={() => setRoute('settings')}
          onInstall={() => setRoute('setup')}
          onReset={() => setRoute('reset')}
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
    default:
      return (
        <ProvisioningScreen
          onHome={() => setRoute('home')}
          onSettings={() => setRoute('settings')}
          onReset={() => setRoute('reset')}
          onCheck={() => setRoute('status')}
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
