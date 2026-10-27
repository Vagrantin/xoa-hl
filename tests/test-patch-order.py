"""Exercise rejection of patch names and dependency order before source fetch/build."""
from pathlib import Path
import subprocess
import tempfile
import unittest

VALIDATOR = Path(__file__).resolve().parents[1] / 'scripts/validate-patches.sh'

class PatchOrder(unittest.TestCase):
    def validate(self, names, dependencies=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entries = []
            for name in names:
                (root / (name + '.patch')).touch()
                deps = (dependencies or {}).get(name, [])
                entries.append(f'''[[patches]]
id = "{name}"
description = "fixture"
target = "fixture"
upstream_commit = "fixture"
applies_to = ["5.113.2"]
maintainer = "fixture"
status = "active"
dependencies = {deps!r}
''')
            (root / 'metadata.toml').write_text('\n'.join(entries))
            return subprocess.run(['bash', str(VALIDATOR), directory], capture_output=True, text=True)

    def test_numbered_dependencies(self):
        self.assertEqual(self.validate(['010-base', '020-consumer'], {'020-consumer': ['010-base']}).returncode, 0)

    def test_repeated_letters_rejected(self):
        self.assertNotEqual(self.validate(['zzzz-feature']).returncode, 0)

    def test_duplicate_number_rejected(self):
        self.assertNotEqual(self.validate(['010-one', '010-two']).returncode, 0)

    def test_dependency_must_precede_consumer(self):
        self.assertNotEqual(self.validate(['010-consumer', '020-base'], {'010-consumer': ['020-base']}).returncode, 0)

    def test_unknown_dependency_rejected(self):
        self.assertNotEqual(self.validate(['010-consumer'], {'010-consumer': ['missing']}).returncode, 0)

if __name__ == '__main__':
    unittest.main()
