#!/usr/bin/env python3
"""Audit the pinned XO UI catalog after the XOA-HL patches have been applied.

The upstream catalog has incomplete translations. Report those gaps, but require
all XOA-HL strings and the prioritized inherited core UI keys to be translated.
"""

import argparse
import re
from pathlib import Path


ENTRY = re.compile(r"^  ([A-Za-z]\w*):[ \t]*(.*)$", re.MULTILINE)


def arguments(message):
    """Collect ICU arguments at the outer level, excluding plural branches."""
    depth = 0
    names = set()
    for index, char in enumerate(message):
        if char == "{":
            if depth == 0:
                match = re.match(r"([A-Za-z]\w*)(?=,|\})", message[index + 1 :])
                if match:
                    names.add(match.group(1))
            depth += 1
        elif char == "}":
            depth -= 1
            if depth < 0:
                raise ValueError("unexpected closing brace")
    if depth:
        raise ValueError("unclosed brace")
    return names


def entries(path):
    return dict(ENTRY.findall(path.read_text(encoding="utf-8")))


def string_value(source, key):
    # Translations are single-line JS string literals; the English reference
    # has some long messages on the following line.
    expression = re.search(
        rf"^  {re.escape(key)}:\s*('(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"),",
        source,
        re.MULTILINE,
    )
    return expression.group(1) if expression else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("xo_source", type=Path, help="patched xen-orchestra checkout")
    args = parser.parse_args()
    catalog = args.xo_source / "packages/xo-web/src/common/intl"
    english_path = catalog / "messages.js"
    english_source = english_path.read_text(encoding="utf-8")
    english = entries(english_path)
    custom = {key for key in english if key.startswith("xoaHl")}
    custom.add("settingsXoaHlUpdatesPage")
    core = {
        line.strip()
        for line in Path(__file__).with_name("core-ui-keys.txt").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    }
    failures = []
    print("Locale | missing catalog keys | undefined entries | XOA-HL translated | core UI translated")
    print("--- | ---: | ---: | ---: | ---:")
    locale_paths = sorted((catalog / "locales").glob("*.js"))
    if len(locale_paths) != 13 or len(custom) != 61:
        failures.append(f"expected 13 locales and 61 XOA-HL keys; found {len(locale_paths)} and {len(custom)}")
    if len(core) != 83 or core - english.keys() or core & custom:
        failures.append("core UI key list must contain 83 distinct inherited English catalog keys")
    for path in locale_paths:
        source = path.read_text(encoding="utf-8")
        translated = entries(path)
        missing = len(english.keys() - translated.keys())
        undefined = sum(value.startswith("undefined") for value in translated.values())
        passed_custom = 0
        passed_core = 0
        for key in sorted(custom | core):
            occurrences = re.findall(rf"^  {re.escape(key)}:", source, re.MULTILINE)
            if len(occurrences) != 1:
                failures.append(f"{path.name}: expected one definition of {key}, found {len(occurrences)}")
                continue
            value = string_value(source, key)
            reference = string_value(english_source, key)
            if value is None or reference is None:
                failures.append(f"{path.name}: missing or non-string {key}")
                continue
            if value[1:-1].strip() == "":
                failures.append(f"{path.name}: empty {key}")
                continue
            try:
                expected = arguments(reference)
                actual = arguments(value)
            except ValueError as error:
                failures.append(f"{path.name}: {key} has invalid ICU braces: {error}")
                continue
            if actual != expected:
                failures.append(f"{path.name}: {key} ICU arguments {sorted(actual)} != {sorted(expected)}")
                continue
            if key in custom:
                passed_custom += 1
            else:
                passed_core += 1
        print(f"{path.stem} | {missing} | {undefined} | {passed_custom}/{len(custom)} | {passed_core}/{len(core)}")
    for failure in failures:
        print("ERROR:", failure)
    return bool(failures)


if __name__ == "__main__":
    raise SystemExit(main())
