import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('read_chat', ROOT / 'SOURCES/xoa-hl-run-read-chat.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class ConfigurationTests(unittest.TestCase):
    def enabled(self):
        return dict(enabled=True, provider='llama', model='local-model', endpoint='http://127.0.0.1:8080',
                    context_limit=4096, xo_url='https://127.0.0.1', mcp_package='/opt/local-mcp')

    def test_default_is_disabled_without_runtime_or_credentials(self):
        config = json.loads((ROOT / 'SOURCES/xoa-hl-assistant.json').read_text())
        self.assertFalse(module.validate_config(config))
        with tempfile.TemporaryDirectory() as temp:
            result = subprocess.run([sys.executable, str(ROOT / 'SOURCES/xoa-hl-run-read-chat.py'),
                                     '--config', str(ROOT / 'SOURCES/xoa-hl-assistant.json'),
                                     '--request-file', '/missing/request', '--state-dir', str(Path(temp) / 'state')],
                                    text=True, capture_output=True)
            self.assertEqual(result.returncode, 3)
            self.assertEqual(json.loads(result.stdout), {'enabled': False})
            self.assertFalse((Path(temp) / 'state').exists())

    def test_complete_local_configuration(self):
        self.assertTrue(module.validate_config(self.enabled()))

    def test_cloud_remote_ambiguous_or_unmeasured_configuration_rejected(self):
        for change in [dict(enabled='false'), dict(provider='openai'), dict(model='model:cloud'),
                       dict(endpoint='https://example.com'), dict(xo_url='http://u:p@localhost'),
                       dict(mcp_package='relative'), dict(context_limit=None), dict(context_limit=True),
                       dict(mode='auto'), dict(extra_extension='developer')]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                module.validate_config({**self.enabled(), **change})


if __name__ == '__main__':
    unittest.main()
