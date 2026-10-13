#!/bin/sh
# The store of the mint's proofs (software 1.20), checked on the card itself (see ProofStoreCheck.java): set-up, a piece loaded
# with a proof and read back, a plain piece that reads 00, a payment, a reset. It refuses a card that is not blank, and ends
# with the card blank.
#
#   sh tools/chip/proofstore.sh                    the card in the reader (PC/SC)
#   sh tools/chip/proofstore.sh 127.0.0.1:47470    a card behind tools/chip/run.sh, or the simulator's server (tools/cardsim/run.sh)
#
# Needs a JDK (11 or later) and GlobalPlatformPro's jar for its PC/SC binding: GP_JAR, or gp.jar beside this script.
set -e
cd "$(dirname "$0")"
JAR="${GP_JAR:-$PWD/gp.jar}"
[ -f "$JAR" ] || { echo "gp.jar not found: set GP_JAR to GlobalPlatformPro's jar" >&2; exit 1; }
mkdir -p classes
javac -cp "$JAR" -d classes ProofStoreCheck.java
exec java -cp "$JAR:classes" ProofStoreCheck "$@"
