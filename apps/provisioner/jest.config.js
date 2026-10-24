module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Exercise the same public source entry points Metro selects on the phone.
  testEnvironmentOptions: {customExportConditions: ['react-native']},
  // the preset's list, and react-native-nfc-manager, whose error classes the
  // tests take from the library itself (jest.setup.js)
  moduleNameMapper: {'\\.svg$': '<rootDir>/__mocks__/svgMock.js'},
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-nfc-manager|@cashu-card/cardkit)/)',
  ],
};
