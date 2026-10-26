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
DATA = dict(hosts=[dict(id='h-a', name='host-a', cpus=4, memory_free_mb=4096, enabled=True, running=True), dict(id='h-b', name='host-b', cpus=4, memory_free_mb=1024, enabled=True, running=True)],
            srs=[dict(id='sr-a', name='local', eligible_hosts=['h-a'], free_gb=100)],
            networks=[dict(id='net-a', name='lan', eligible_hosts=['h-a', 'h-b'])], templates=[dict(id='tpl-a', name='alma', eligible_hosts=['h-a', 'h-b'])], vms=[])


class ProposalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'proposals.sqlite'
        self.now = [1000]
        self.store = m.Proposals(self.path, clock=lambda: self.now[0])
        self.addCleanup(self.store.close)
        self.turn = self.store.begin_turn('user-a', 'session-a', 'Test request')

    def snapshot(self):
        return dict(version=2, complete=True, observed_at=self.now[0], data=copy.deepcopy(DATA))

    def plan(self, **kwargs):
        return self.store.propose('user-a', 'session-a', 'Test request', {**SPEC, **kwargs}, self.snapshot(), turn_id=self.turn)

    def test_full_spec_is_immutable_and_host_resolved_before_approval(self):
        spec = {k: v for k, v in SPEC.items() if k != 'host'}
        plan = self.store.propose('user-a', 'session-a', 'Test request', spec, self.snapshot(), turn_id=self.turn)
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
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM audit WHERE event='preflight_rejected'").fetchone()[0], 11)

    def test_name_collision(self):
        snapshot = self.snapshot(); snapshot['data']['vms'] = [dict(name=SPEC['name'])]
        with self.assertRaisesRegex(m.Rejected, 'name_collision'):
            self.store.propose('user-a', 'session-a', 'Test request', SPEC, snapshot, turn_id=self.turn)

    def test_ambiguous_resource_names_fail_closed(self):
        snapshot = self.snapshot(); snapshot['data']['networks'].append(dict(id='net-b', name='lan', eligible_hosts=['h-a', 'h-b']))
        with self.assertRaisesRegex(m.Rejected, 'ambiguous_snapshot'):
            self.store.propose('user-a', 'session-a', 'Test request', SPEC, snapshot, turn_id=self.turn)

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
            self.store.propose('user-a', 'session-a', 'Test request', SPEC, snapshot, turn_id=self.turn)
        plan = self.plan(); changed = self.snapshot(); changed['data']['srs'][0]['free_gb'] = 1
        with self.assertRaisesRegex(m.Rejected, 'insufficient_storage'):
            self.store.decide('user-a', 'session-a', plan['id'], 'approve', changed)
        self.assertEqual(self.store.get('user-a', 'session-a', plan['id'])['status'], 'invalidated')

    def test_edit_requires_new_id_and_invalidates_old_approval(self):
        old = self.plan()
        new = self.store.propose('user-a', 'session-a', 'Test request', {**SPEC, 'memory_mb': 3072}, self.snapshot(), turn_id=self.turn, replaces=old['id'])
        self.assertNotEqual(new['id'], old['id'])
        self.assertEqual(self.store.get('user-a', 'session-a', old['id'])['status'], 'superseded')
        with self.assertRaisesRegex(m.Rejected, 'unavailable'):
            self.store.decide('user-a', 'session-a', old['id'], 'approve', self.snapshot())
        self.assertEqual(new['spec']['memory_mb'], 3072)

    def test_invalid_edit_also_cancels_previous_pending_plan(self):
        old = self.plan()
        with self.assertRaises(m.Rejected):
            self.store.propose('user-a', 'session-a', 'Test request', {**SPEC, 'memory_mb': 999999}, self.snapshot(), turn_id=self.turn, replaces=old['id'])
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

    def test_incomplete_inventory_cannot_use_history_as_collision_check(self):
        for change in [dict(complete=False), dict(version=1)]:
            snapshot = {**self.snapshot(), **change}
            with self.assertRaisesRegex(m.Rejected, 'incomplete_snapshot'):
                self.store.propose('user-a', 'session-a', 'Test request', SPEC, snapshot, turn_id=self.turn)
        snapshot = self.snapshot(); snapshot['data'].pop('vms')
        snapshot['data']['recent_vms'] = []
        with self.assertRaisesRegex(m.Rejected, 'invalid_snapshot'):
            self.store.propose('user-a', 'session-a', 'Test request', SPEC, snapshot, turn_id=self.turn)

    def test_invalid_numeric_inventory_cannot_bypass_capacity(self):
        for bad in [float('nan'), float('inf'), -1, True, '4096', None]:
            for collection, field in [('hosts', 'memory_free_mb'), ('srs', 'free_gb')]:
                snapshot = self.snapshot(); snapshot['data'][collection][0][field] = bad
                with self.subTest(bad=bad, field=field), self.assertRaises(m.Rejected):
                    self.store.propose('user-a', 'session-a', 'Test request', SPEC, snapshot, turn_id=self.turn)

    def test_placement_requires_all_resources_on_enabled_running_host(self):
        for collection in ('srs', 'networks', 'templates'):
            snapshot = self.snapshot(); snapshot['data'][collection][0]['eligible_hosts'] = ['h-b']
            with self.subTest(collection=collection), self.assertRaisesRegex(m.Rejected, 'no_feasible_host'):
                self.store.propose('user-a', 'session-a', 'Test request', SPEC, snapshot, turn_id=self.turn)
        for flag in ('running', 'enabled'):
            snapshot = self.snapshot(); snapshot['data']['hosts'][0][flag] = False
            with self.assertRaisesRegex(m.Rejected, 'no_feasible_host'):
                self.store.propose('user-a', 'session-a', 'Test request', SPEC, snapshot, turn_id=self.turn)

    def test_same_name_cannot_rebind_to_a_replacement_resource(self):
        for collection in ('srs', 'networks', 'templates'):
            proposal = self.plan(name='replacement-' + collection)
            snapshot = self.snapshot(); snapshot['data'][collection][0]['id'] += '-replacement'
            with self.subTest(collection=collection), self.assertRaisesRegex(m.Rejected, 'resource_replaced'):
                self.store.decide('user-a', 'session-a', proposal['id'], 'approve', snapshot)
            self.assertEqual(self.store.get('user-a', 'session-a', proposal['id'])['status'], 'invalidated')

    def test_resource_reachability_is_rechecked_at_approval(self):
        proposal = self.plan(); snapshot = self.snapshot()
        snapshot['data']['networks'][0]['eligible_hosts'] = []
        with self.assertRaisesRegex(m.Rejected, 'no_feasible_host'):
            self.store.decide('user-a', 'session-a', proposal['id'], 'approve', snapshot)

    def test_cancellation_invalidates_only_the_authenticated_conversation(self):
        mine = self.plan()
        other_turn = self.store.begin_turn('user-a', 'other-session', 'test')
        other = self.store.propose('user-a', 'other-session', 'test', {**SPEC, 'name': 'other'}, self.snapshot(), turn_id=other_turn)
        self.assertTrue(self.store.revoke_turn('user-a', 'session-a', self.turn, 'cancelled'))
        self.assertEqual(self.store.get('user-a', 'other-session', other['id'])['status'], 'pending')
        with self.assertRaisesRegex(m.Rejected, 'unavailable'):
            self.store.decide('user-a', 'session-a', mine['id'], 'approve', self.snapshot())

    def test_bounded_tags_and_resource_names(self):
        for change in [dict(tags=['same', 'same']), dict(tags=['']), dict(tags=['x' * 129]),
                       dict(tags=[str(i) for i in range(33)]), dict(network=''), dict(template='x' * 257)]:
            with self.subTest(change=change), self.assertRaisesRegex(m.Rejected, 'invalid_schema'):
                self.plan(**change)


    def test_plan_expiry_does_not_outlive_its_turn(self):
        self.now[0] += 290
        plan = self.plan()
        self.assertEqual(plan['expires_at'], 1300)
        self.now[0] = 1300
        with self.assertRaisesRegex(m.Rejected, 'proposal_expired'):
            self.store.decide('user-a', 'session-a', plan['id'], 'approve', self.snapshot())

    def test_migration_retains_old_audit_but_does_not_authorize_unscoped_plans(self):
        import sqlite3
        legacy = Path(self.temp.name) / 'legacy.sqlite'
        connection = sqlite3.connect(legacy)
        connection.execute("CREATE TABLE proposals(id TEXT PRIMARY KEY, owner TEXT, session TEXT, request TEXT, spec TEXT, digest TEXT, snapshot_digest TEXT, created REAL, expires REAL, status TEXT, resource_ids TEXT)")
        connection.execute('INSERT INTO proposals VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            ('old-plan', 'user-a', 'session-a', 'Test request', m.canonical(SPEC), 'digest', 'snapshot', 1000, 1300, 'pending', '{}'))
        connection.commit(); connection.close(); os.chmod(legacy, 0o600)
        migrated = m.Proposals(legacy, clock=lambda: 1000); self.addCleanup(migrated.close)
        self.assertEqual(migrated.get('user-a', 'session-a', 'old-plan')['spec'], SPEC)
        with self.assertRaisesRegex(m.Rejected, 'turn_unavailable'):
            migrated.decide('user-a', 'session-a', 'old-plan', 'approve', self.snapshot())
        turn = migrated.begin_turn('user-a', 'session-a', 'new request')
        plan = migrated.propose('user-a', 'session-a', 'new request', SPEC, self.snapshot(), turn_id=turn)
        self.assertEqual(plan['status'], 'pending')

    def test_cancelled_turn_cannot_publish_after_restart(self):
        self.store.revoke_turn('user-a', 'session-a', self.turn)
        other = m.Proposals(self.path, clock=lambda: self.now[0]); self.addCleanup(other.close)
        with self.assertRaisesRegex(m.Rejected, 'turn_unavailable'):
            other.propose('user-a', 'session-a', 'Test request', SPEC, self.snapshot(), turn_id=self.turn)
        self.assertEqual(other.db.execute('SELECT count(*) FROM proposals').fetchone()[0], 0)

    def test_old_cleanup_cannot_cancel_new_turn_or_invalidate_new_plan(self):
        old = self.turn
        self.turn = self.store.begin_turn('user-a', 'session-a', 'Test request')
        plan = self.plan()
        self.assertNotEqual(old, self.turn)
        self.assertFalse(self.store.revoke_turn('user-a', 'session-a', old))
        with self.assertRaisesRegex(m.Rejected, 'turn_unavailable'):
            self.store.invalidate_pending('user-a', 'session-a', turn_id=old)
        self.assertEqual(self.store.get('user-a', 'session-a', plan['id'])['status'], 'pending')

    def test_turn_is_bound_to_identity_request_and_deadline(self):
        for owner, session, request, token in [
            ('user-b', 'session-a', 'Test request', self.turn),
            ('user-a', 'session-b', 'Test request', self.turn),
            ('user-a', 'session-a', 'forged request', self.turn),
            ('user-a', 'session-a', 'Test request', 'forged'),
        ]:
            with self.assertRaisesRegex(m.Rejected, 'turn_unavailable'):
                self.store.propose(owner, session, request, SPEC, self.snapshot(), turn_id=token)
        self.now[0] += 301
        with self.assertRaisesRegex(m.Rejected, 'turn_unavailable'):
            self.plan()

    def test_legacy_unscoped_plan_cannot_be_approved(self):
        plan = self.plan()
        self.store.db.execute('UPDATE proposals SET turn_id=NULL WHERE id=?', (plan['id'],))
        with self.assertRaisesRegex(m.Rejected, 'turn_unavailable'):
            self.store.decide('user-a', 'session-a', plan['id'], 'approve', self.snapshot())
        self.assertEqual(self.store.get('user-a', 'session-a', plan['id'])['status'], 'invalidated')

    def test_cancel_between_validation_and_commit_rejects_at_atomic_barrier(self):
        # Serialization is deliberately outside the SQL transaction. Revoke on
        # an independent connection in that gap, after validation succeeded.
        original_canonical = m.canonical
        cancelled = [False]
        def serialise(value):
            if value is not SPEC and isinstance(value, dict) and value.get('version') == 2 and not cancelled[0]:
                cancelled[0] = True
                other = m.Proposals(self.path, clock=lambda: self.now[0])
                try:
                    other.revoke_turn('user-a', 'session-a', self.turn)
                finally:
                    other.close()
            return original_canonical(value)
        m.canonical = serialise
        try:
            with self.assertRaisesRegex(m.Rejected, 'turn_unavailable'):
                self.plan()
        finally:
            m.canonical = original_canonical
        self.assertTrue(cancelled[0])
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM proposals').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
