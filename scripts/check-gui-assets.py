#!/usr/bin/env python3
"""Verify both advertised GUIs and the packaged /v6 mount before archiving XO."""
from html.parser import HTMLParser
from pathlib import Path
import re
import sys
from urllib.parse import urljoin, urlsplit, unquote


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and attrs.get('src'):
            self.urls.append(attrs['src'])
        if tag == 'link' and attrs.get('href'):
            self.urls.append(attrs['href'])


def check(root):
    root = Path(root).resolve()
    server = root / 'packages/xo-server'
    config = (server / 'config.toml').read_text()
    section = re.search(r'^\[http\.mounts\]\s*\n(.*?)(?=^\[|\Z)', config, re.M | re.S)
    if section is None:
        raise ValueError('Missing authenticated mount section')
    match = re.search(r"^['\"]/v6['\"]\s*=\s*['\"]([^'\"]+)['\"]", section[1], re.M)
    if match is None:
        raise ValueError('Missing authenticated /v6 mount')
    preview = (server / match[1]).resolve()
    expected = root / '@xen-orchestra/web/dist'
    if preview != expected:
        raise ValueError('Unexpected /v6 mount target')
    for path in (root / 'packages/xo-web/dist/index.html', preview / 'index.html'):
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError('Missing GUI entry page: ' + str(path))
    html = Assets()
    html.feed((preview / 'index.html').read_text())
    count = 0
    for url in html.urls:
        parsed = urlsplit(url)
        if parsed.scheme or parsed.netloc:
            raise ValueError('Preview entry assets must be bundled locally: ' + url)
        path = unquote(urlsplit(urljoin('/v6/', url)).path)
        if not path.startswith('/v6/'):
            raise ValueError('Asset escapes /v6: ' + url)
        asset = (preview / path[len('/v6/'):]).resolve()
        if preview not in asset.parents or not asset.is_file() or asset.stat().st_size == 0:
            raise ValueError('Missing preview asset: ' + url)
        count += path.endswith('.js')
    if count == 0:
        raise ValueError('Preview entry page has no bundled JavaScript')
    print('XO 5 entry, /v6 mount and preview entry assets verified')


if __name__ == '__main__':
    check(sys.argv[1])
