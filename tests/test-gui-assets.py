import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('assets', Path(__file__).resolve().parents[1] / 'scripts/check-gui-assets.py')
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)


class GuiAssetsTest(unittest.TestCase):
    def fixture(self, root):
        entries = {
            'packages/xo-server/config.toml': "[http.mounts]\n'/v6' = '../../@xen-orchestra/web/dist/'\n",
            'packages/xo-web/dist/index.html': '<html>XO5</html>',
            '@xen-orchestra/web/dist/index.html': '<script type="module" src="./assets/main.js"></script><link rel="stylesheet" href="./assets/main.css">',
            '@xen-orchestra/web/dist/assets/main.js': 'export {}',
            '@xen-orchestra/web/dist/assets/main.css': 'body{}',
        }
        for name, content in entries.items():
            p = root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content)

    def test_complete_and_missing_preview(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            assets.check(root)
            (root / '@xen-orchestra/web/dist/index.html').unlink()
            with self.assertRaises(ValueError): assets.check(root)

    def test_missing_asset_and_wrong_mount(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            (root / '@xen-orchestra/web/dist/assets/main.js').unlink()
            with self.assertRaises(ValueError): assets.check(root)
            self.fixture(root)
            (root / 'packages/xo-server/config.toml').write_text('[http.mounts]\n')
            with self.assertRaises(ValueError): assets.check(root)

    def test_external_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            (root / '@xen-orchestra/web/dist/index.html').write_text('<script src="https://example.invalid/app.js"></script>')
            with self.assertRaises(ValueError): assets.check(root)


if __name__ == '__main__': unittest.main()
