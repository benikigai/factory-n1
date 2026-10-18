#!/usr/bin/env bash
set -euo pipefail

minutes="${1:-105}"
if [[ "$minutes" != 65 && "$minutes" != 105 ]]; then
  echo 'Only the critic (105m) and optimizer (65m) backup deadlines are supported.' >&2
  exit 1
fi

# Re-running setup must not extend the original spending window.
if systemctl is-active --quiet factory-n1-hard-stop.timer; then
  echo 'The existing shutdown timer remains armed.'
else
  sudo systemd-run --unit=factory-n1-hard-stop --on-active="${minutes}m" \
    --timer-property=AccuracySec=1s /sbin/shutdown -h now
fi
systemctl list-timers --all --no-pager factory-n1-hard-stop.timer
echo 'Copy artifacts off this VM before the timer fires; verify Stopped in Crusoe afterward.'
