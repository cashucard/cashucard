/* global jest */
// The NFC module is native; the tests drive cardkit with their own transceivers.
// Its error classes are plain JavaScript and are the library's own, so a test
// throws what the phone would.
jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  NfcError: jest.requireActual('react-native-nfc-manager/src/NfcError'),
  default: {
    start: jest.fn(() => Promise.resolve()),
    requestTechnology: jest.fn(() =>
      Promise.reject(new Error('no NFC in tests')),
    ),
    cancelTechnologyRequest: jest.fn(() => Promise.resolve()),
    setAlertMessageIOS: jest.fn(() => Promise.resolve()),
    setTimeout: jest.fn(() => Promise.resolve()),
    getTimeout: jest.fn(() => Promise.resolve(15000)),
    getMaxTransceiveLength: jest.fn(() => Promise.resolve(261)),
    isoDepHandler: {
      transceive: jest.fn(() => Promise.reject(new Error('no card'))),
    },
  },
  NfcTech: {IsoDep: 'IsoDep'},
}));
