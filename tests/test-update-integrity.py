"""Exercise the real transaction script with command doubles; no host RPMs touched."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class IntegrityTests(unittest.TestCase):
    def run_update(self, phase):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            dnf = base / 'dnf'
            dnf.write_text('''#!/bin/sh
echo "$*" >> "$CALLS"
case " $* " in
  *" update "*) touch "$UPDATED"; exit "${UPDATE_RC:-0}" ;;
  *" check "*)
    if [ "$PHASE" = pre ] || { [ "$PHASE" = post ] && [ -e "$UPDATED" ]; }; then exit 1; fi ;;
esac
''')
            rpm = base / 'rpm'
            rpm.write_text('''#!/bin/sh
case "$1" in
  -qa) echo kernel-core-1.x86_64 ;;
  -V)
    if [ "$PHASE" = kernel-pre ] || { [ "$PHASE" = kernel-post ] && [ -e "$UPDATED" ]; }; then
      echo 'S.5...... /lib/modules/1/vmlinuz'; exit 1
    fi ;;
esac
''')
            dnf.chmod(0o755)
            rpm.chmod(0o755)
            env = dict(os.environ, DNF_COMMAND=str(dnf), RPM_COMMAND=str(rpm),
                       PHASE=phase, CALLS=str(base / 'calls'), UPDATED=str(base / 'updated'),
                       XOA_HL_STATE_DIR=str(base / 'state'), XOA_HL_CONFIG_DIR=str(base / 'config'),
                       XOA_HL_DNF_LOCK_FILE=str(base / 'lock'),
                       XOA_HL_CHECK_SCRIPT=str(base / 'absent'),
                       XOA_HL_CHECK_STATUS_FILE=str(base / 'status'))
            for key in ('XOA_HL_UPDATE_LOG',):
                env.pop(key, None)
            run = subprocess.run(['sh', str(ROOT / 'SOURCES/xoa-hl-update.sh')], env=env, capture_output=True)
            log = (base / 'state/update.log').read_text()
            return run.returncode, log, (base / 'updated').exists()

    def test_clean_transaction(self):
        rc, log, updated = self.run_update('clean')
        self.assertEqual(rc, 0)
        self.assertTrue(updated)
        self.assertIn('finished successfully', log)

    def test_preflight_blocks_duplicate_or_corrupt_kernel(self):
        for phase in ('pre', 'kernel-pre'):
            with self.subTest(phase=phase):
                rc, log, updated = self.run_update(phase)
                self.assertNotEqual(rc, 0)
                self.assertFalse(updated)
                self.assertNotIn('finished successfully', log)

    def test_postflight_rejects_duplicate_or_corrupt_kernel(self):
        for phase in ('post', 'kernel-post'):
            with self.subTest(phase=phase):
                rc, log, updated = self.run_update(phase)
                self.assertNotEqual(rc, 0)
                self.assertTrue(updated)
                self.assertNotIn('finished successfully', log)


if __name__ == '__main__':
    unittest.main()
