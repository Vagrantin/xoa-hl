#!/usr/bin/env python3
"""Exercise coverage and source-layer drift in the porting inventory."""

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
from io import StringIO
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("patch_porting", ROOT / "scripts/patch-porting.py")
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class PortingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.patches = self.root / "patches"
        self.patches.mkdir()
        (self.root / "docs").mkdir()
        self.metadata = self.patches / "metadata.toml"
        self.content = '''[[patches]]
id = "010-example"
description = "Test mixed layers"
upstream_commit = "e281c536d3b1e97ccfb3b0826f91b7dbb6c4478c"
applies_to = ["5.113.2"]
porting_backend = "Preserve the API contract."
porting_frontend = "Rewrite the client."
'''
        self.metadata.write_text(self.content)
        (self.patches / "series").write_text("010-example.patch\n")
        self.diff = self.patches / "010-example.patch"
        self.diff.write_text(
            "diff --git a/packages/xo-server/src/api/example.mjs b/packages/xo-server/src/api/example.mjs\n"
            "--- a/packages/xo-server/src/api/example.mjs\n+++ b/packages/xo-server/src/api/example.mjs\n"
            "@@ -1 +1 @@\n-old\n+new\n"
            "diff --git a/packages/xo-web/src/old.js b/packages/xo-web/src/old.js\n"
            "deleted file mode 100644\n--- a/packages/xo-web/src/old.js\n+++ /dev/null\n"
            "@@ -1 +0,0 @@\n-old\n"
        )

    def test_mixed_and_removed_file_layers_are_preserved(self):
        row = inventory.collect(self.root)[0]
        self.assertEqual(row["layers"], ["backend", "frontend"])
        self.assertIn("packages/xo-web/src/old.js", row["paths"])

    def test_missing_backend_plan_fails(self):
        self.metadata.write_text(self.content.replace('porting_backend = "Preserve the API contract."\n', ""))
        with self.assertRaisesRegex(ValueError, "porting fields"):
            inventory.collect(self.root)

    def test_empty_or_invented_layer_fails(self):
        for text in [self.content.replace("Preserve the API contract.", " "),
                     self.content + 'porting_other = "Invented layer."\n']:
            with self.subTest(text=text):
                self.metadata.write_text(text)
                with self.assertRaises(ValueError):
                    inventory.collect(self.root)

    def test_unclassified_new_source_family_fails(self):
        self.diff.write_text(self.diff.read_text().replace("packages/xo-web/", "packages/new-client/"))
        with self.assertRaisesRegex(ValueError, "classify new source layer"):
            inventory.collect(self.root)

    def test_new_patch_and_removed_metadata_fail_coverage(self):
        (self.patches / "020-new.patch").write_text(self.diff.read_text())
        with self.assertRaisesRegex(ValueError, "cover patch files"):
            inventory.collect(self.root)
        (self.patches / "series").write_text("010-example.patch\n020-new.patch\n")
        with self.assertRaisesRegex(ValueError, "metadata does not cover"):
            inventory.collect(self.root)

    def test_patch_change_invalidates_generated_evidence(self):
        generated = inventory.render(inventory.collect(self.root))
        (self.root / "docs/patch-porting.md").write_text(generated)
        self.diff.write_text(self.diff.read_text().replace("+new\n", "+different\n"))
        with patch.object(inventory, "ROOT", self.root), patch.object(sys, "argv", ["patch-porting.py"]):
            with redirect_stderr(StringIO()), redirect_stdout(StringIO()):
                self.assertEqual(inventory.main(), 1)
                with patch.object(sys, "argv", ["patch-porting.py", "--write"]):
                    self.assertEqual(inventory.main(), 0)
                self.assertEqual(inventory.main(), 0)
        self.assertNotEqual(generated, (self.root / "docs/patch-porting.md").read_text())

    def test_invalid_series_and_diff_paths_fail(self):
        (self.patches / "series").write_text("../010-example.patch\n")
        with self.assertRaisesRegex(ValueError, "invalid series"):
            inventory.collect(self.root)
        with self.assertRaisesRegex(ValueError, "invalid patch diff"):
            inventory.patch_paths("diff --git a/../outside b/../outside\n")

    def test_legacy_unified_diff_is_classified(self):
        paths = inventory.patch_paths(
            "--- a/packages/xo-server/src/old.mjs\n+++ b/packages/xo-server/src/old.mjs\n"
            "@@ -1 +1 @@\n-old\n+new\n"
        )
        self.assertEqual(paths, ["packages/xo-server/src/old.mjs"])


if __name__ == "__main__":
    unittest.main()
