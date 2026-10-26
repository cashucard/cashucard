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
import {ServiceSelectorScreen} from './src/screens/ServiceSelectorScreen';
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
  | 'home'
  | 'setup'
  | 'settings'
  | 'bench'
  | 'identity'
  | 'reset'
  | 'status';
type Tool = 'identity' | 'reset' | 'status';
type ToolOrigin = 'home' | 'setup' | 'settings' | 'status';
const initialOrigins: Record<Tool, ToolOrigin> = {
  identity: 'settings',
  reset: 'home',
  status: 'home',
};
const resetBackLabels: Record<ToolOrigin, string> = {
  home: 'BACK TO CARDS',
  setup: 'RETURN TO BATCH',
  settings: 'BACK TO SETTINGS',
  status: 'BACK TO CARD CHECK',
};

const benchStyles = {
  benchWrap: {flex: 1} as const,
  benchBack: {padding: 16} as const,
};

function Navigator(): React.JSX.Element {
  const app = useApp();
  const recovery = useProvisioning();
  const [route, setRoute] = useState<Route>('home');
  const [choosingService, setChoosingService] = useState(false);
  const [origins, setOrigins] = useState(initialOrigins);
  const openTool = (tool: Tool, origin: ToolOrigin) => {
    if (recovery.busy) {
      return;
    }
    setOrigins(previous => ({...previous, [tool]: origin}));
    setRoute(tool);
  };
  useEffect(() => {
    setRoute('home');
    setOrigins(initialOrigins);
  }, [
    app.session?.operator_id,
    app.session?.env,
    app.serviceUrl,
    app.signedIn,
  ]);

  if (!app.signedIn || !app.session) {
    return choosingService ? (
      <ServiceSelectorScreen onDone={() => setChoosingService(false)} />
    ) : (
      <SignInScreen onServices={() => setChoosingService(true)} />
    );
  }
  if (route === 'home') {
    return (
      <CardsHomeScreen
        onInstall={() => setRoute('setup')}
        onReset={() => openTool('reset', 'home')}
        onCheck={() => openTool('status', 'home')}
        onSettings={() => setRoute('settings')}
      />
    );
  }
  if (route === 'setup') {
    return (
      <ProvisioningScreen
        onHome={() => setRoute('home')}
        onSettings={() => setRoute('settings')}
        onReset={() => openTool('reset', 'setup')}
        onCheck={() => openTool('status', 'setup')}
      />
    );
  }
  const visibleRoute =
    route === 'bench' && !BENCH_RUNS_ENABLED ? 'settings' : route;
  switch (visibleRoute) {
    case 'settings':
      return (
        <SettingsScreen
          onChangeService={() => {
            if (!recovery.busy) {
              setChoosingService(true);
              app.signOut();
            }
          }}
          onBack={() => setRoute('home')}
          onBench={() => {
            if (BENCH_RUNS_ENABLED && !recovery.busy) {
              setRoute('bench');
            }
          }}
          onIdentity={() => openTool('identity', 'settings')}
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
          onBack={() => setRoute(origins.identity)}
          disabled={recovery.busy}
        />
      );
    case 'reset':
      return (
        <ResetCardScreen
          onBack={() => setRoute(origins.reset)}
          backLabel={resetBackLabels[origins.reset]}
          onInstall={() => setRoute('setup')}
        />
      );
    case 'status':
      return (
        <CardStatusScreen
          onBack={() => setRoute(origins.status)}
          onInstall={() => setRoute('setup')}
          onReset={() => openTool('reset', 'status')}
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
          onReset={() => openTool('reset', 'setup')}
          onCheck={() => openTool('status', 'setup')}
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
