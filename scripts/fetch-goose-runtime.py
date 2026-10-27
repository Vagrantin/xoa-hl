#!/usr/bin/env python3
"""Fetch the pinned released CLI for CI packaging; never execute downloaded code."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tarfile
import tempfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def verify_archive(path, pin):
    if hashlib.sha256(path.read_bytes()).hexdigest() != pin['sha256']:
        raise ValueError('goose archive checksum mismatch')
    with tarfile.open(path, 'r:bz2') as archive:
        files = []
        for member in archive.getmembers():
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or member.issym() or member.islnk():
                raise ValueError('unsafe archive member')
            if member.isfile():
                if name.as_posix() not in ('goose', './goose') or not 0 < member.size < 300 * 1024**2:
                    raise ValueError('unexpected executable in archive')
                files.append(member.name)
            elif not member.isdir() or name.as_posix() != '.':
                raise ValueError('unexpected archive member')
        if len(files) != 1:
            raise ValueError('expected exactly one executable')


def fetch(output, verify_only=False):
    pin = json.loads((ROOT / 'GOOSE_RUNTIME.json').read_text())
    expected = f"https://github.com/aaif-goose/goose/releases/download/v{pin['version']}/{pin['archive']}"
    if pin['url'] != expected or pin['platform'] != 'x86_64-unknown-linux-musl' or pin['enabled_by_default'] is not False:
        raise ValueError('invalid runtime pin')
    if output.exists() or verify_only:
        verify_archive(output, pin)
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.goose-download-', dir=output.parent)
    try:
        with os.fdopen(fd, 'wb') as dest, urlopen(pin['url'], timeout=60) as source:
            total = 0
            while data := source.read(1024 * 1024):
                total += len(data)
                if total > 100 * 1024**2:
                    raise ValueError('download exceeds expected size bound')
                dest.write(data)
        verify_archive(Path(name), pin)
        # Refuse to overwrite a concurrently created cache entry.
        os.link(name, output)
    finally:
        Path(name).unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    fetch(args.output, args.verify_only)
