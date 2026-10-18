module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // tools/cardkit is outside this app; its @noble/hashes comes from here
  modulePaths: ['<rootDir>/node_modules'],
  // the preset's list, and react-native-nfc-manager, whose error classes the
  // tests take from the library itself (jest.setup.js)
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-nfc-manager)/)',
  ],
};
