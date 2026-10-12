#!/bin/sh
# The card in a reader on this machine, on a loopback port, speaking the same
# lines as the simulated card's server (tools/cardsim/run.sh): so the live
# suites of the phone's repository run against the chip itself.
#
#   sh tools/chip/run.sh [port] [look]     47470 unless said; "look" lets only reading commands through
#   sh tools/chip/reset.sh                 a card the reader has given up on, reset without being taken out
#   sh tools/chip/proofstore.sh            software 1.20's store of the mint's proofs, checked on a blank card (ProofStoreCheck.java)
#
# Needs a JDK (11 or later) and GlobalPlatformPro's jar for its PC/SC binding:
# GP_JAR, or gp.jar beside this script.
set -e
cd "$(dirname "$0")"
JAR="${GP_JAR:-$PWD/gp.jar}"
[ -f "$JAR" ] || { echo "gp.jar not found: set GP_JAR to GlobalPlatformPro's jar" >&2; exit 1; }
mkdir -p classes
javac -cp "$JAR" -d classes ChipBridge.java CardReset.java
exec java -cp "$JAR:classes" ChipBridge "${1:-47470}" "${2:-full}" chip-bridge.log
