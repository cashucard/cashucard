#!/bin/bash
set -e

# Load the same private Node-path overrides as the standard React Native phase.
# An empty argument loads the environment without running its optional command.
source "$REACT_NATIVE_PATH/scripts/xcode/with-environment.sh" ""

# Check every non-Debug configuration, including custom archive configurations.
# No bypass flag: diagnostic builds must use Debug when targeting a local service.
if [ "${CONFIGURATION:?Missing Xcode configuration}" != "Debug" ]; then
  "$NODE_BINARY" "$SRCROOT/../scripts/configure-service.cjs" --check --production
fi

exec /bin/bash "$REACT_NATIVE_PATH/scripts/react-native-xcode.sh"
