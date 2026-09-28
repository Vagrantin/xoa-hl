# Automatic appliance updates

XOA-HL keeps manual update controls available in every mode and ships automatic
installation disabled. Installing or upgrading the RPM never opts an appliance
into unattended updates.

## Modes

| Mode | Timers | Behaviour |
|---|---|---|
| `manual` | both disabled | checks and updates are started by an administrator |
| `check` | check timer enabled | refreshes the update status; installation remains manual |
| `install` | automatic-update timer enabled | checks and installs during the configured maintenance window |

Configure a mode with the root-owned validated helper:

```bash
# MODE FREQUENCY DAY TIME RANDOM_DELAY_MINUTES
sudo /usr/libexec/xoa-hl/configure-updates.sh check weekly Sun 03:00 15
sudo /usr/libexec/xoa-hl/configure-updates.sh install weekly Sun 03:00 15
sudo /usr/libexec/xoa-hl/configure-updates.sh manual daily Sun 03:00 15
```

Accepted random delays are `0`, `5`, `10`, `15`, `30`, and `60` minutes. The
day argument is validated in every mode and is used only for a weekly schedule.
The time is interpreted in the appliance's local timezone.

The helper writes `/etc/xoa-hl/update.conf` and fixed timer drop-ins under
`/etc/systemd/system/`, validates the calendar with `systemd-analyze`, reloads
systemd, and enables only the timer required by the selected mode.

## Safety behaviour

- automatic installation uses `Persistent=false`, so a missed maintenance
  window is not replayed immediately after boot;
- update checks use `Persistent=true` and also run shortly after boot;
- manual and scheduled DNF jobs share a non-blocking `flock` lock;
- Node.js is excluded from a general DNF update and the RPM requires Node.js 24
  but less than 25;
- automatic reboot is not supported and remains disabled;
- the updater records its durable result in
  `/var/lib/xoa-hl/auto-update.status` and streams the transaction to
  `/var/lib/xoa-hl/update.log`.

Inspect scheduling and results with:

```bash
systemctl list-timers 'xoa-hl-*'
systemctl status xoa-hl-check-update.timer xoa-hl-auto-update.timer
cat /var/lib/xoa-hl/auto-update.status
journalctl -u xoa-hl-auto-update.service
```
