#!/bin/sh
# A card on this Mac for Foxy in the iOS Simulator: the applet, in the JavaCard
# simulator, on a loopback port (applet/src/test/java/.../CardServer.java).
#
#   sh tools/cardsim/run.sh [port]        47431 unless said; Foxy tries 47431 to 47434
#   sh tools/cardsim/run.sh [port] plain  the one key every jCardSim card has, and not a key of its own:
#                                         for a card whose money was locked to that key before cards had their own
#   sh tools/cardsim/ctl.sh [port] off    take the card off the reader (on, pull N, new, show)
#
# Needs a JDK (11 or later) and Maven, as the tests do.
set -e
cd "$(dirname "$0")/../../applet"
PORT="${1:-47431}"
mvn -q test-compile
JAR="$(find "$HOME/.m2/repository" -name 'jcardsim-3.0.6.0.jar' | head -1)"
[ -n "$JAR" ] || { echo "jcardsim is not in ~/.m2 yet: run the tests once (mvn -f applet/pom.xml test)" >&2; exit 1; }
exec java -cp "target/classes:target/test-classes:$JAR" me.flashapp.cashu.CardServer "$PORT" ${2:+"$2"}
