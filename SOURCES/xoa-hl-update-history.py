#!/usr/bin/python3
"""Keep the last five unattended update results and installed RPM changes."""
import argparse
import json
import os
from pathlib import Path
import tempfile


def parse_snapshot(text):
    return dict(line.split('\t', 1) for line in text.splitlines() if '\t' in line)


def record(path, result, before, after):
    packages = []
    if before is not None and after is not None:
        for name in sorted(before.keys() | after.keys()):
            old, new = before.get(name), after.get(name)
            if old != new:
                packages.append({'name': name, 'previousVersion': old, 'version': new})
    result = dict(result, packages=packages, packagesKnown=before is not None and after is not None)
    try:
        history = json.loads(path.read_text())
        if not isinstance(history, list):
            raise ValueError('history must be a list')
    except FileNotFoundError:
        history = []
    # The auto-update systemd unit serializes writers. Replace atomically for readers.
    fd, temp = tempfile.mkstemp(prefix='.history-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(([result] + history)[:5], stream)
            stream.write('\n')
        os.chmod(temp, 0o644)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def main():
    parser = argparse.ArgumentParser()
    for name in ('path', 'before', 'after', 'startedAt', 'finishedAt', 'result', 'exitCode', 'rebootNeeded'):
        parser.add_argument('--' + name, required=True)
    args = vars(parser.parse_args())
    snapshots = []
    for name in ('before', 'after'):
        p = Path(args.pop(name))
        snapshots.append(parse_snapshot(p.read_text()) if p.exists() else None)
    path = Path(args.pop('path'))
    args['exitCode'] = int(args['exitCode'])
    record(path, args, *snapshots)


if __name__ == '__main__':
    main()
