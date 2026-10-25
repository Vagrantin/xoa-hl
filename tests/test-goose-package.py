import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fetch_goose', ROOT / 'scripts/fetch-goose-runtime.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ArchiveTests(unittest.TestCase):
    def archive(self, members):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        path = Path(temp.name) / 'goose.tar.bz2'
        with tarfile.open(path, 'w:bz2') as archive:
            for name, kind in members:
                item = tarfile.TarInfo(name)
                if kind == 'file':
                    item.size = 4
                    archive.addfile(item, io.BytesIO(b'test'))
                elif kind == 'symlink':
                    item.type = tarfile.SYMTYPE
                    item.linkname = '/bin/sh'
                    archive.addfile(item)
                else:
                    item.type = tarfile.DIRTYPE
                    archive.addfile(item)
        return path, {'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

    def test_single_expected_regular_binary(self):
        path, pin = self.archive([('.', 'directory'), ('./goose', 'file')])
        module.verify_archive(path, pin)

    def test_checksum_mismatch(self):
        path, pin = self.archive([('./goose', 'file')])
        pin['sha256'] = '0' * 64
        with self.assertRaises(ValueError):
            module.verify_archive(path, pin)

    def test_unsafe_and_unexpected_members(self):
        for members in [[('../goose', 'file')], [('/goose', 'file')], [('./goose', 'symlink')],
                        [('./goose', 'file'), ('./extra', 'file')], [('./subdir', 'directory')],
                        [('./goose', 'file'), ('./goose', 'file')], []]:
            with self.subTest(members=members):
                path, pin = self.archive(members)
                with self.assertRaises(ValueError):
                    module.verify_archive(path, pin)

    def test_pin_version_and_package_disable_contract(self):
        pin = json.loads((ROOT / 'GOOSE_RUNTIME.json').read_text())
        package = (ROOT / 'SPECS/xoa-hl-goose.spec').read_text()
        self.assertEqual(re.search(r'^Version:\s+(\S+)$', package, re.M)[1], pin['version'])
        self.assertIs(pin['enabled_by_default'], False)
        self.assertIs(json.loads((ROOT / 'SOURCES/xoa-hl-assistant.json').read_text())['enabled'], False)
        self.assertFalse(re.search(r'^%(?:post(?:trans|un)?|pre(?:trans|un)?|trigger\w*)\b', package, re.M))
        self.assertNotIn('systemd/system', package)

    def test_license_matches_pinned_upstream_blob(self):
        data = (ROOT / 'SOURCES/goose-LICENSE').read_bytes()
        git_sha = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        self.assertEqual(git_sha, 'c83043d4494071fbd93ef245a14e573c5a8280c4')


if __name__ == '__main__':
    unittest.main()
