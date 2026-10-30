#!/usr/bin/python3
"""Publish this guest's bounded, nonsecret installed identity for XAPI (#30)."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

KEY = 'control/xoa-hl-identity'
VERSION = re.compile(r'[A-Za-z0-9_.:+-]{1,256}\Z')
IMAGE = re.compile(r'xoa-image-[0-9]{8}(?:-[0-9]{15})?-[0-9a-f]{7,40}\Z')
LEGACY = re.compile(r'built [0-9]{4}-[0-9]{2}-[0-9]{2}, commit [0-9a-f]{7,40}, release v[A-Za-z0-9_.+-]{1,160}\Z')

def text_file(root, path, pattern):
    try:
        with (root / path).open() as stream:
            value = stream.read(513).strip()
        return value if len(value) <= 512 and pattern.fullmatch(value) else None
    except (OSError, UnicodeError):
        return None

def collect(run=subprocess.run, root=Path('/'), now=None):
    version = run(['/bin/rpm', '-q', '--qf', '%{VERSION}-%{RELEASE}', 'xoa-hl'], check=True, capture_output=True, text=True, timeout=10).stdout.strip()
    if not VERSION.fullmatch(version):
        raise ValueError('invalid installed version')
    exact = text_file(root, 'etc/xoa-hl-image-tag', IMAGE)
    legacy = text_file(root, 'etc/xoa-hl-vm-release', LEGACY)
    return {'schema': 1, 'product': 'xoa-hl', 'application': version, 'image': exact or legacy,
            'reported_at': (now or datetime.now(timezone.utc)).strftime('%Y-%m-%dT%H:%M:%SZ')}

def publish(clear=False, run=subprocess.run, root=Path('/'), now=None):
    domid = run(['xenstore-read', 'domid'], check=True, capture_output=True, text=True, timeout=10).stdout.strip()
    if not domid.isdigit() or int(domid) == 0:
        return
    if clear:
        run(['xenstore-rm', KEY], check=False, capture_output=True, timeout=10)
        return
    identity = collect(run, root, now)
    encoded = json.dumps(identity, ensure_ascii=True, separators=(',', ':'))
    if len(encoded.encode()) > 1024:
        raise ValueError('identity exceeds XenStore budget')
    # One atomic value, scoped by XenStore to this guest's domain. No host login.
    run(['xenstore-write', KEY, encoded], check=True, capture_output=True, timeout=10)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clear', action='store_true')
    args = parser.parse_args()
    if not all(shutil.which(tool) for tool in ['xenstore-read', 'xenstore-write', 'xenstore-rm']):
        sys.exit(0)
    try:
        publish(args.clear)
    except (OSError, ValueError, subprocess.SubprocessError):
        print('Unable to publish XOA-HL guest identity', file=sys.stderr)
        sys.exit(1)
