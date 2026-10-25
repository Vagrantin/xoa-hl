"""Actual pinned goose/MCP binaries against a local scripted provider/XO fixture."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.environ.get('GOOSE_BIN') and os.environ.get('MCP_PACKAGE'), 'set the verified binaries/installed MCP path')
class ReadOnlyRuntimeSmoke(unittest.TestCase):
    def test_actual_read_and_forbidden_calls(self):
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                requests.append(('GET', self.path))
                if not self.path.startswith('/rest/v0/hosts') or self.headers.get('cookie') != 'authenticationToken=TEST_TOKEN':
                    self.send_error(404); return
                self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers()
                self.wfile.write(json.dumps([{'id': 'fixture-host', 'name_label': 'lab host'}]).encode())
            def do_POST(self):
                requests.append(('POST', self.path))
                if self.path != '/v1/chat/completions':
                    self.send_error(404); return
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                turn = sum(m.get('role') == 'assistant' for m in body.get('messages', []))
                names = {t['function']['name'] for t in body.get('tools', [])}
                if 'xoread__create_vm' in names or 'xoread__search_documentation' in names:
                    self.send_error(500); return
                choices = [('read-hosts', 'xoread__list_hosts', {}),
                           ('blocked-docs', 'xoread__search_documentation', {'topic': 'manage'}),
                           ('blocked-skill', 'load_skill', {'name': 'probe-skill'})]
                delta = {'role': 'assistant', 'content': 'Read-only fixture finished.'}
                reason = 'stop'
                if turn < len(choices):
                    ident, name, arguments = choices[turn]
                    delta = {'role': 'assistant', 'content': None, 'tool_calls': [{'index': 0, 'id': ident,
                             'type': 'function', 'function': {'name': name, 'arguments': json.dumps(arguments)}}]}
                    reason = 'tool_calls'
                self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
                chunk = {'id': 'fixture', 'object': 'chat.completion.chunk', 'created': 0, 'model': body.get('model'),
                         'choices': [{'index': 0, 'delta': delta, 'finish_reason': reason}]}
                self.wfile.write(('data: ' + json.dumps(chunk) + '\n\ndata: [DONE]\n\n').encode())
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        self.addCleanup(server.server_close); self.addCleanup(server.shutdown)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            endpoint = 'http://127.0.0.1:' + str(server.server_port)
            config = dict(enabled=True, provider='llama', model='fixture', endpoint=endpoint,
                          context_limit=4096, xo_url=endpoint, mcp_package=str(Path(os.environ['MCP_PACKAGE']).resolve()))
            (root / 'config.json').write_text(json.dumps(config))
            (root / 'request.txt').write_text('Read the lab host list. Do not create or change anything.')
            command = [sys.executable, str(ROOT / 'SOURCES/xoa-hl-run-read-chat.py'), '--config', str(root / 'config.json'),
                       '--goose', str(Path(os.environ['GOOSE_BIN']).resolve()), '--node', shutil.which('node'),
                       '--request-file', str(root / 'request.txt'), '--state-dir', str(root / 'state')]
            env = {'PATH': os.environ.get('PATH', ''), 'XO_TOKEN': 'TEST_TOKEN'}
            result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=40)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertTrue(any(method == 'GET' and path.startswith('/rest/v0/hosts') for method, path in requests))
            self.assertTrue(all(path == '/v1/chat/completions' or (method == 'GET' and path.startswith('/rest/v0/hosts')) for method, path in requests))
            events = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
            responses = [c for e in events if e.get('type') == 'message' for c in e.get('message', {}).get('content', []) if c.get('type') == 'toolResponse']
            skill = next(c for c in responses if c.get('id') == 'blocked-skill')
            self.assertTrue(skill['toolResult']['value']['isError'])
            self.assertRegex(json.dumps(skill).lower(), r'denied|declined|permission|not allowed|never.allow')
            permission = json.loads((root / 'state/goose/config/permission.yaml').read_text())
            self.assertEqual(permission['user']['never_allow'], ['load_skill'])
            self.assertEqual(json.loads((root / 'state/goose/config/config.yaml').read_text())['GOOSE_MODE'], 'approve')


if __name__ == '__main__':
    unittest.main()
