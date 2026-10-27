#!/usr/bin/env python3
"""Remove untranslated XO locale entries before bundling xo-web.

react-intl falls back to the default message when a locale does not contain a
message ID.  XO 5 represents missing translations as thousands of explicit
``key: undefined`` properties, and Browserify includes every locale in the
initial application bundle.  Omitting those properties preserves the fallback
while reducing the JavaScript downloaded and parsed on a cold login.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path


UNDEFINED_ENTRY = re.compile(
    r"^[ \t]+(?:[$A-Z_a-z][$\w]*|'[^'\n]+'|\"[^\"\n]+\"):[ \t]*undefined,[ \t]*(?:\r?\n|$)",
    re.MULTILINE,
)


def compact(locale_path: Path) -> tuple[int, int]:
    source = locale_path.read_text(encoding="utf-8")
    compacted, removed = UNDEFINED_ENTRY.subn("", source)
    if removed:
        locale_path.write_text(compacted, encoding="utf-8")
    return removed, len(source.encode("utf-8")) - len(compacted.encode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("xo_root", type=Path, help="patched xen-orchestra checkout")
    parser.add_argument(
        "--minimum-entries",
        type=int,
        default=0,
        help="fail if fewer entries are removed (detects an incompatible upstream catalog)",
    )
    args = parser.parse_args()

    locale_dir = args.xo_root / "packages/xo-web/src/common/intl/locales"
    locale_paths = sorted(locale_dir.glob("*.js"))
    if len(locale_paths) != 13:
        parser.error(f"expected 13 XO locale files in {locale_dir}, found {len(locale_paths)}")

    total_entries = 0
    total_bytes = 0
    for locale_path in locale_paths:
        entries, source_bytes = compact(locale_path)
        total_entries += entries
        total_bytes += source_bytes

    if total_entries < args.minimum_entries:
        parser.error(
            f"removed {total_entries} entries, expected at least {args.minimum_entries}; "
            "the pinned XO locale format may have changed"
        )

    print(
        f"Compacted {total_entries} untranslated locale entries "
        f"({total_bytes} source bytes) across {len(locale_paths)} locales"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
