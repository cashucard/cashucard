/**
 * The Cashu card provisioner (ENG-738): a bench spike that installs the card's
 * applet from a phone over NFC.
 */
import React from 'react';

import {LoadTestScreen} from './src/screens/LoadTestScreen';

export default function App(): React.JSX.Element {
  return <LoadTestScreen />;
}
