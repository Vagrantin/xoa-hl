import copy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

m = load('command', 'SOURCES/xoa-hl-proposal-command.py')
fixture = load('proposal_fixture', 'tests/test-assistant-proposals.py')


class CommandTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'state.sqlite'
        self.store = m.mcp.proposals.Proposals(self.path); self.addCleanup(self.store.close)
        self.snapshot = dict(version=2, complete=True, observed_at=time.time(), data=copy.deepcopy(fixture.DATA))

    def command(self, action, **args):
        return m.execute(dict(action=action, owner='alice', session='trusted', **args), self.store)

    def plan(self):
        turn = self.command('begin', request='create a VM')['turn_id']
        return self.store.propose('alice', 'trusted', 'create a VM', fixture.SPEC, self.snapshot, turn_id=turn), turn

    def test_full_propose_get_approve_and_audit_roundtrip(self):
        plan, _ = self.plan()
        self.assertEqual(self.command('get', id=plan['id']), plan)
        result = self.command('decide', id=plan['id'], decision='approve', snapshot=self.snapshot)
        self.assertEqual(result['status'], 'approved_dry_run'); self.assertFalse(result['created'])
        audit = self.store.db.execute("SELECT owner,detail FROM audit WHERE event='approved_dry_run'").fetchone()
        self.assertEqual(audit['owner'], 'alice')
        self.assertEqual(json.loads(audit['detail'])['request'], 'create a VM')

    def test_actual_command_process_uses_durable_state_and_preserves_unicode(self):
        plan, _ = self.plan()
        script = 'import importlib.util,sys; s=importlib.util.spec_from_file_location("cmd",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.serve(sys.stdin.buffer,sys.stdout.buffer,sys.argv[2])'
        def run(message):
            proc = subprocess.run(['python3', '-c', script, str(ROOT / 'SOURCES/xoa-hl-proposal-command.py'), str(self.path)],
                input=json.dumps(message).encode(), capture_output=True, timeout=10, check=True)
            self.assertEqual(proc.stderr, b'')
            return json.loads(proc.stdout)
        self.assertEqual(run(dict(action='get', owner='alice', session='trusted', id=plan['id']))['result'], plan)
        self.assertFalse(run(dict(action='get', owner='other', session='trusted', id=plan['id']))['ok'])
        self.assertTrue(run(dict(action='begin', owner='alice', session='trusted', request='日本語：新しいVM'))['ok'])
        self.assertEqual(self.store.db.execute('SELECT request FROM turns').fetchone()[0], '日本語：新しいVM')

    def test_private_protocol_has_no_execution_or_path_override(self):
        for message in [dict(action='delete', owner='alice', session='trusted'),
            dict(action='begin', owner='alice', session='trusted', request='a VM', database='/tmp/forged'),
            dict(action='decide', owner='alice', session='trusted', id='x', decision='approve', snapshot={}, spec={})]:
            with self.assertRaises(ValueError): m.execute(message, self.store)

    def test_cancellation_replacement_and_cross_session_are_enforced(self):
        plan, turn = self.plan()
        self.assertTrue(self.command('revoke', turn_id=turn, reason='cancelled')['revoked'])
        self.assertEqual(self.command('get', id=plan['id'])['status'], 'invalidated')
        with self.assertRaises(m.mcp.proposals.Rejected):
            self.command('decide', id=plan['id'], decision='approve', snapshot=self.snapshot)
        with self.assertRaises(m.mcp.proposals.Rejected):
            m.execute(dict(action='get', owner='alice', session='other', id=plan['id']), self.store)

    def test_malformed_duplicate_and_oversized_commands_are_redacted(self):
        for raw in [b'{', b'{"action":"get","action":"begin"}', b'{"secret":"credential-value"}', b'x' * (m.MAX_INPUT + 1)]:
            output = io.BytesIO(); m.serve(io.BytesIO(raw), output, self.path)
            self.assertEqual(json.loads(output.getvalue()), {'ok': False, 'error': 'proposal_unavailable'})


if __name__ == '__main__': unittest.main()
