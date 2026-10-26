import copy
import errno
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
m = load('create_mcp', 'SOURCES/xoa-hl-create-mcp.py')
fixture = load('proposal_fixture', 'tests/test-assistant-proposals.py')


class McpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.store = m.proposals.Proposals(self.path / 'state.sqlite')
        self.addCleanup(self.store.close)
        self.snapshot = dict(version=2, complete=True, observed_at=time.time(), data=copy.deepcopy(fixture.DATA))
        self.reads = 0
        def read():
            self.reads += 1
            return self.snapshot
        self.extension = m.Extension(self.store, owner='trusted-user', session='trusted-session', request='trusted request', read_inventory=read)
        self.call('initialize', {'protocolVersion': '2025-03-26'})

    def call(self, method, params=None):
        return self.extension.handle(dict(jsonrpc='2.0', id=1, method=method, params=params or {}))

    def propose(self, spec=None):
        return self.call('tools/call', dict(name='create_vm', arguments=spec or fixture.SPEC))['result']

    def test_exactly_one_tool_no_decision_or_platform_mutation_surface(self):
        self.assertEqual([t['name'] for t in self.call('tools/list')['result']['tools']], ['create_vm'])
        for tool in ('delete_vm', 'start_vm', 'approve', 'decide', 'search_documentation'):
            self.assertIn('error', self.call('tools/call', {'name': tool, 'arguments': {}}))
        for method in ('resources/read', 'prompts/list', 'decision', 'sampling/createMessage'):
            self.assertEqual(self.call(method)['error']['code'], -32601)
        self.assertEqual(self.reads, 0)

    def test_plan_uses_trusted_actor_and_request_and_never_creates(self):
        result = self.propose(); self.assertFalse(result['isError'])
        plan = json.loads(result['content'][0]['text'])
        self.assertFalse(plan['created']); self.assertEqual(plan['mode'], 'propose_only')
        row = self.store.db.execute('SELECT * FROM proposals').fetchone()
        self.assertEqual(row['owner'], 'trusted-user'); self.assertEqual(row['request'], 'trusted request')
        for key in ('owner', 'session', 'request', 'snapshot', 'approve', 'mode'):
            self.assertTrue(self.propose({**fixture.SPEC, key: 'forged'})['isError'])

    def test_every_attempt_reads_fresh_inventory_and_changed_capacity_rejects(self):
        self.assertFalse(self.propose()['isError'])
        self.snapshot['data']['srs'][0]['free_gb'] = 0
        self.assertTrue(self.propose()['isError'])
        self.assertEqual(self.reads, 2)
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM proposals WHERE status='pending'").fetchone()[0], 0)

    def test_broker_failure_is_redacted_and_invalidates_previous_proposal(self):
        self.propose()
        def broken():
            raise RuntimeError('secret token and private inventory')
        self.extension.read_inventory = broken
        result = self.propose()
        self.assertTrue(result['isError']); self.assertNotIn('secret', json.dumps(result))
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM proposals WHERE status='pending'").fetchone()[0], 0)

    def test_tool_limit_and_schema_failures_never_issue_approval(self):
        for _ in range(6):
            self.assertFalse(self.propose()['isError'])
        self.assertIn('tool_call_limit', self.propose()['content'][0]['text'])
        self.assertEqual(self.reads, 6)

    def test_new_authenticated_turn_invalidates_old_pending_plan(self):
        plan = json.loads(self.propose()['content'][0]['text'])
        m.Extension(self.store, owner='trusted-user', session='trusted-session', request='cancel that', read_inventory=lambda: self.snapshot)
        self.assertEqual(self.store.get('trusted-user', 'trusted-session', plan['id'])['status'], 'invalidated')

    def test_framing_duplicate_keys_and_initialize_boundary(self):
        source = io.BytesIO(b'{"jsonrpc":"2.0","id":1,"method":"ping","method":"tools/list"}\n')
        out = io.BytesIO(); m.serve(self.extension, source, out)
        self.assertEqual(json.loads(out.getvalue())['error']['code'], -32700)
        out = io.BytesIO(); m.serve(self.extension, io.BytesIO(b'x' * (m.MAX_MESSAGE + 1)), out)
        self.assertEqual(out.getvalue(), b'')
        self.assertIn('error', self.call('initialize', {'protocolVersion': '2025-03-26'}))
        self.assertIsNone(self.extension.handle(dict(jsonrpc='2.0', method='notifications/initialized')))

    def test_actual_stdio_process_and_private_inventory_socket(self):
        path = self.path / 'inventory.sock'
        try:
            server = socket.socket(socket.AF_UNIX)
        except OSError as error:
            if error.errno == errno.EPERM and os.environ.get('ASSISTANT_REQUIRE_SOCKET_TEST') != '1':
                self.skipTest('local runtime disallows sockets; mandatory in public CI')
            raise
        server.bind(str(path)); server.listen(1)
        os.chmod(path, 0o600)
        self.addCleanup(server.close)
        errors = []
        def serve_inventory():
            try:
                server.settimeout(10)
                peer, _ = server.accept()
                with peer, peer.makefile('rb') as stream:
                    request = json.loads(stream.readline())
                    self.assertEqual(request, {'method': 'inventory', 'version': 2})
                    peer.sendall((json.dumps(self.snapshot) + '\n').encode())
            except BaseException as error:
                errors.append(error)
        thread = threading.Thread(target=serve_inventory, daemon=True); thread.start()
        context = dict(owner='process-user', session='process-session', request='process request',
                       database=str(self.path / 'subprocess.sqlite'), inventory_socket=str(path))
        with tempfile.TemporaryFile() as fd:
            fd.write(json.dumps(context).encode()); fd.seek(0)
            wire = '\n'.join(json.dumps(row) for row in [
                dict(jsonrpc='2.0', id=1, method='initialize', params={'protocolVersion': '2025-03-26'}),
                dict(jsonrpc='2.0', id=2, method='tools/list'),
                dict(jsonrpc='2.0', id=3, method='tools/call', params={'name': 'create_vm', 'arguments': fixture.SPEC})]) + '\n'
            result = subprocess.run(['python3', str(ROOT / 'SOURCES/xoa-hl-create-mcp.py'), '--context-fd', str(fd.fileno())],
                pass_fds=(fd.fileno(),), input=wire, capture_output=True, text=True, timeout=15)
        thread.join(timeout=10)
        self.assertEqual(errors, []); self.assertFalse(thread.is_alive())
        self.assertEqual(result.returncode, 0, result.stderr)
        records = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(len(records), 3)
        plan = json.loads(records[2]['result']['content'][0]['text'])
        self.assertFalse(plan['created']); self.assertEqual(plan['status'], 'pending')
        os.chmod(path, 0o666)
        with self.assertRaises(ValueError):
            m.private_socket(path)


if __name__ == '__main__':
    unittest.main()
