module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // tools/cardkit is outside this app; its @noble/hashes comes from here
  modulePaths: ['<rootDir>/node_modules'],
};
