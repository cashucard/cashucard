#!/bin/sh
# Resets the card in the reader (see run.sh).
set -e
cd "$(dirname "$0")"
JAR="${GP_JAR:-$PWD/gp.jar}"
[ -f "$JAR" ] || { echo "gp.jar not found: set GP_JAR to GlobalPlatformPro's jar" >&2; exit 1; }
mkdir -p classes
javac -cp "$JAR" -d classes CardReset.java
exec java -cp "$JAR:classes" CardReset
