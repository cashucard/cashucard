const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * The app bundles tools/cardkit's TypeScript from the repo, so Metro watches
 * that folder too. cardkit's own node_modules (its dev tools, for its CI job)
 * and its tests (node:crypto) are kept out of the bundle, and its one
 * dependency, @noble/hashes, resolves from this app's node_modules.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const cardkit = path.resolve(__dirname, '../../tools/cardkit');
const escape = p => p.replace(/[/\\^$.*+?()[\]{}|]/g, '\\$&');
const defaults = getDefaultConfig(__dirname);

const config = {
  watchFolders: [cardkit],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    blockList: [
      defaults.resolver.blockList,
      new RegExp(`^${escape(path.join(cardkit, 'node_modules'))}[/\\\\].*`),
      new RegExp(`^${escape(path.join(cardkit, 'gp', 'test'))}[/\\\\].*`),
    ],
  },
};

module.exports = mergeConfig(defaults, config);
