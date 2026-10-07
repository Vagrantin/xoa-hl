#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/compact-xo-locales.py"


class CompactXoLocalesTest(unittest.TestCase):
    def test_removes_only_undefined_catalog_entries_and_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            xo_root = Path(tmp)
            locale_dir = xo_root / "packages/xo-web/src/common/intl/locales"
            locale_dir.mkdir(parents=True)
            fixture = """export default {
  // Original text: 'Missing'
  missing: undefined,
  translated: 'Translated',
  message: 'the word undefined is preserved',
}
"""
            for locale in ("es", "fa", "fr", "he", "hu", "it", "ja", "pl", "pt", "ru", "sv", "tr", "zh"):
                (locale_dir / f"{locale}.js").write_text(fixture, encoding="utf-8")

            first = subprocess.run(
                ["python3", str(SCRIPT), str(xo_root)],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertIn("Compacted 13 untranslated locale entries", first.stdout)
            output = (locale_dir / "ja.js").read_text(encoding="utf-8")
            self.assertNotIn("missing: undefined", output)
            self.assertIn("translated: 'Translated'", output)
            self.assertIn("the word undefined is preserved", output)

            second = subprocess.run(
                ["python3", str(SCRIPT), str(xo_root)],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertIn("Compacted 0 untranslated locale entries", second.stdout)

    def test_rejects_an_unexpected_locale_set(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                ["python3", str(SCRIPT), tmp],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(0, result.returncode)
            self.assertIn("expected 13 XO locale files", result.stderr)


if __name__ == "__main__":
    unittest.main()
