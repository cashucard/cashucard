const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * cardkit is an installed package. Its react-native export selects source
 * TypeScript; Node consumers use the compiled package. No repository-relative
 * resolver alias can bypass the package's public entry points.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const defaults = getDefaultConfig(__dirname);
defaults.transformer.getTransformOptions = async () => ({
  transform: {experimentalImportSupport: false, inlineRequires: true},
});

const config = {
  // maker/maker.json at the repository's root, the card maker's settings (src/maker.ts), and nothing else outside the app
  watchFolders: [path.resolve(__dirname, '../../maker')],
  transformer: {
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
  },
  resolver: {
    assetExts: defaults.resolver.assetExts.filter(ext => ext !== 'svg'),
    sourceExts: [...defaults.resolver.sourceExts, 'svg'],
    unstable_enablePackageExports: true,
  },
};

module.exports = mergeConfig(defaults, config);
