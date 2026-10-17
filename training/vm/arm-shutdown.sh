#!/usr/bin/env bash
set -euo pipefail

# Re-running setup must not extend the original spending window.
if systemctl is-active --quiet factory-n1-hard-stop.timer; then
  echo 'The existing 105-minute shutdown timer remains armed.'
else
  sudo systemd-run --unit=factory-n1-hard-stop --on-active=105m \
    --timer-property=AccuracySec=1s /sbin/shutdown -h now
fi
systemctl list-timers --all --no-pager factory-n1-hard-stop.timer
echo 'Copy artifacts off this VM before the timer fires; verify Stopped in Crusoe afterward.'
