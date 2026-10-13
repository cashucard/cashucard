#!/bin/sh
# One word to the card that tools/cardsim/run.sh is running:
#   sh tools/cardsim/ctl.sh [port] off | on | pull N | new | show
PORT=47431
case "$1" in ''|*[!0-9]*) ;; *) PORT="$1"; shift ;; esac
printf 'ctl %s\n' "$*" | nc -w 2 127.0.0.1 "$PORT"
