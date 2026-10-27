import copy
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('proposals', ROOT / 'SOURCES/xoa-hl-proposals.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
SPEC = dict(name='proposal-a', template='alma', vcpus=2, memory_mb=2048, disk_gb=20, sr='local', network='lan', host='host-a')
DATA = dict(hosts=[dict(name='host-a', cpus=4, memory_free_mb=4096), dict(name='host-b', cpus=4, memory_free_mb=1024)],
            srs=[dict(name='local', host='host-a', shared=False, free_gb=100)],
            networks=[dict(name='lan')], templates=[dict(name='alma')], recent_vms=[])


class ProposalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'proposals.sqlite'
        self.now = [1000]
        self.store = m.Proposals(self.path, clock=lambda: self.now[0])
        self.addCleanup(self.store.close)

    def snapshot(self):
        return dict(observed_at=self.now[0], data=copy.deepcopy(DATA))

    def plan(self, **kwargs):
        return self.store.propose('user-a', 'session-a', 'Test request', {**SPEC, **kwargs}, self.snapshot())

    def test_full_spec_is_immutable_and_host_resolved_before_approval(self):
        spec = {k: v for k, v in SPEC.items() if k != 'host'}
        plan = self.store.propose('user-a', 'session-a', 'request', spec, self.snapshot())
        self.assertEqual(plan['spec']['host'], 'host-a')
        self.assertFalse(plan['created']); self.assertFalse(plan['live_execution_available'])
        plan['spec']['memory_mb'] = 999999
        self.assertEqual(self.store.get('user-a', 'session-a', plan['id'])['spec']['memory_mb'], 2048)

    def test_invalid_requests_rejected_before_proposal_and_audited(self):
        for change in [dict(vcpus=True), dict(vcpus=0), dict(memory_mb=50000), dict(network='missing'),
                       dict(sr='missing'), dict(template='missing'), dict(host='missing'), dict(host='host-b'),
                       dict(disk_gb=200), dict(command='delete'), dict(tags=[123])]:
            with self.subTest(change=change), self.assertRaises(m.Rejected):
                self.plan(**change)
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM proposals').fetchone()[0], 0)
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM audit').fetchone()[0], 11)

    def test_name_collision(self):
        snapshot = self.snapshot(); snapshot['data']['recent_vms'] = [dict(name=SPEC['name'])]
        with self.assertRaisesRegex(m.Rejected, 'name_collision'):
            self.store.propose('user-a', 'session-a', 'test', SPEC, snapshot)

    def test_ambiguous_resource_names_fail_closed(self):
        snapshot = self.snapshot(); snapshot['data']['networks'].append(dict(name='lan'))
        with self.assertRaisesRegex(m.Rejected, 'ambiguous_snapshot'):
            self.store.propose('user-a', 'session-a', 'test', SPEC, snapshot)

    def test_wrong_user_or_session_cannot_read_or_approve(self):
        plan = self.plan()
        for owner, session in [('user-b', 'session-a'), ('user-a', 'session-b')]:
            with self.assertRaisesRegex(m.Rejected, 'unavailable'):
                self.store.get(owner, session, plan['id'])
            with self.assertRaisesRegex(m.Rejected, 'unavailable'):
                self.store.decide(owner, session, plan['id'], 'approve', self.snapshot())
        self.assertEqual(self.store.get('user-a', 'session-a', plan['id'])['status'], 'pending')

    def test_approval_is_one_shot_persistent_and_never_executes(self):
        plan = self.plan()
        approved = self.store.decide('user-a', 'session-a', plan['id'], 'approve', self.snapshot())
        self.assertEqual(approved['status'], 'approved_dry_run'); self.assertFalse(approved['created'])
        with self.assertRaisesRegex(m.Rejected, 'unavailable'):
            self.store.decide('user-a', 'session-a', plan['id'], 'approve', self.snapshot())
        other = m.Proposals(self.path, clock=lambda: self.now[0]); self.addCleanup(other.close)
        self.assertEqual(other.get('user-a', 'session-a', plan['id'])['status'], 'approved_dry_run')
        event = other.db.execute("SELECT detail FROM audit WHERE event='approved_dry_run'").fetchone()[0]
        self.assertEqual(json.loads(event)['spec'], approved['spec'])
        self.assertFalse(json.loads(event)['created'])

    def test_reject_and_expire(self):
        rejected = self.plan()
        self.assertEqual(self.store.decide('user-a', 'session-a', rejected['id'], 'reject')['status'], 'rejected')
        expired = self.plan(name='proposal-b'); self.now[0] += 301
        with self.assertRaisesRegex(m.Rejected, 'expired'):
            self.store.decide('user-a', 'session-a', expired['id'], 'approve', self.snapshot())
        self.assertEqual(self.store.get('user-a', 'session-a', expired['id'])['status'], 'expired')

    def test_stale_snapshot_and_changed_capacity_fail_closed(self):
        snapshot = self.snapshot(); snapshot['observed_at'] -= 31
        with self.assertRaisesRegex(m.Rejected, 'stale_snapshot'):
            self.store.propose('user-a', 'session-a', 'test', SPEC, snapshot)
        plan = self.plan(); changed = self.snapshot(); changed['data']['srs'][0]['free_gb'] = 1
        with self.assertRaisesRegex(m.Rejected, 'insufficient_storage'):
            self.store.decide('user-a', 'session-a', plan['id'], 'approve', changed)
        self.assertEqual(self.store.get('user-a', 'session-a', plan['id'])['status'], 'invalidated')

    def test_edit_requires_new_id_and_invalidates_old_approval(self):
        old = self.plan()
        new = self.store.propose('user-a', 'session-a', 'Correction: 3 GB', {**SPEC, 'memory_mb': 3072}, self.snapshot(), replaces=old['id'])
        self.assertNotEqual(new['id'], old['id'])
        self.assertEqual(self.store.get('user-a', 'session-a', old['id'])['status'], 'superseded')
        with self.assertRaisesRegex(m.Rejected, 'unavailable'):
            self.store.decide('user-a', 'session-a', old['id'], 'approve', self.snapshot())
        self.assertEqual(new['spec']['memory_mb'], 3072)

    def test_invalid_edit_also_cancels_previous_pending_plan(self):
        old = self.plan()
        with self.assertRaises(m.Rejected):
            self.store.propose('user-a', 'session-a', 'Impossible correction', {**SPEC, 'memory_mb': 999999}, self.snapshot(), replaces=old['id'])
        self.assertEqual(self.store.get('user-a', 'session-a', old['id'])['status'], 'invalidated')

    def test_concurrent_approvals_share_persistent_daily_quota(self):
        a = self.plan(); b = self.plan(name='proposal-b')
        def approve(ident):
            store = m.Proposals(self.path, daily_quota=1, clock=lambda: 1000)
            try:
                return store.decide('user-a', 'session-a', ident, 'approve', self.snapshot())['status']
            except m.Rejected as error:
                return str(error)
            finally:
                store.close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(approve, [a['id'], b['id']]))
        self.assertCountEqual(results, ['approved_dry_run', 'daily_quota'])

    def test_private_file_contract(self):
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        with tempfile.TemporaryDirectory() as other:
            os.chmod(other, 0o755)
            with self.assertRaises(ValueError):
                m.Proposals(Path(other) / 'db')


if __name__ == '__main__':
    unittest.main()
