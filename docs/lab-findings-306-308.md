# Appliance corrections from the ce47 lab

These changes target XOA-HL's fixed XO 5.113.2 (`e281c536`) appliance.
Source tests do not replace acceptance on a newly built RPM/image.

## Interrupted updates (#306)

The managed updater now checks package dependency consistency and verifies all
installed kernel-core/kernel-modules/kernel-modules-core payloads before and after
DNF. Any failure prevents a success marker. It does not automatically erase or
reinstall packages. A previous incomplete installation can require manual repair.

After an interrupted update, with no managed update or other DNF transaction running,
inspect `dnf check`, `dnf history info`, and `rpm -V` for the affected kernel packages.
The lab's verified recovery was:

```sh
dnf remove --duplicates
dnf reinstall kernel-core-<ver> kernel-modules-core-<ver> kernel-modules-<ver>
dnf check
rpm -V kernel-core-<ver> kernel-modules-core-<ver> kernel-modules-<ver>
grubby --default-kernel
```

Replace `<ver>` with the exact affected installed version-release. Review DNF's
proposed transaction before accepting it. Preserve the known working kernel and
reboot only after package verification and boot-entry inspection succeed. Confirm
`uname -r`, sign-in and inventory after reboot. The guard checks RPM payload integrity;
it cannot prove bootloader correctness or protect against every storage failure.

## Update state (#307)

Missing status after boot returns `checked: false`; invalid status is an error.
The page uses its existing localized unknown-status message. Duplicate requests
return `started: false, busy: true`, including API requests racing each other;
systemd remains responsible for serializing the actual unit. Reboot detection uses
standalone `needs-restarting -r` when available, otherwise EL9's
`dnf needs-restarting -r`. Exit 0 means no reboot, 1 means reboot, other exits unknown.

## Reference findings (#308)

- The RPM restricts the operator config to mode 0600 on install and upgrade while
  preserving its contents. `/root` traversal permissions also affect actual access;
  mode 0644 alone does not prove that an unprivileged account could read the file.
- CI stamps the pinned upstream commit into the packaged xo-server directory.
  Startup uses it instead of invoking git in the deliberately pruned payload;
  source checkouts retain the existing git comparison. This does not repair or
  promise the About page's independent remote-master lookup.
- The welcome banner uses the informational alert style.
- **Try XO 6** remains the bundled preview deliberately added by earlier work.
  The supported manual and release baseline remain XO 5; the preview is outside
  that scope. Hiding it would reverse the earlier feature decision.
- `token.deleteOwn` without arguments is an upstream finding reserved for the
  dedicated upstream workflow. Use an explicit `tokens=json:["<owned-token-id>"]`
  selection when intentionally revoking tokens. Proposed upstream correction:
  validate that a selector is supplied and return a parameter error rather than
  dereferencing missing input. No upstream fix is included here.

## Deployed acceptance still required

Run #306's power-loss injection on a disposable appliance, confirm failure on
the inconsistent state and success after verified repair. Exercise reboot-needed
and no-reboot updates, two simultaneous start calls, status immediately after boot,
config preservation/mode after upgrade, clean startup logs and the banner in light
and dark appearance. Do not treat these source changes as released until CI builds
and the installed tests identify the exact RPM/image.
