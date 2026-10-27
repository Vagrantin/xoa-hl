#!/usr/bin/env python3
"""Propose-only approval state. No XO client, network or VM execution path."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import time

HERE = Path(__file__).resolve().parent
SCHEMA = json.loads((HERE / 'xoa-hl-create-vm.schema.json').read_text())


class Rejected(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def validate(spec, snapshot, now, max_age=30):
    if not isinstance(snapshot, dict) or type(snapshot.get('observed_at')) not in (int, float) or not 0 <= now - snapshot['observed_at'] <= max_age:
        raise Rejected('stale_snapshot')
    if not isinstance(spec, dict) or set(spec) - set(SCHEMA['properties']) or not set(SCHEMA['required']) <= set(spec):
        raise Rejected('invalid_schema')
    try:
        encoded_size = len(canonical(spec).encode())
    except (ValueError, TypeError):
        raise Rejected('invalid_schema')
    if encoded_size > 65536:
        raise Rejected('spec_too_large')
    for key, value in spec.items():
        rule = SCHEMA['properties'][key]
        kind = rule['type']
        if kind == 'integer':
            if type(value) is not int or value < rule.get('minimum', value) or value > rule.get('maximum', value):
                raise Rejected('invalid_schema')
        elif kind == 'string':
            if not isinstance(value, str) or len(value) < rule.get('minLength', 0) or len(value) > rule.get('maxLength', len(value)) or ('pattern' in rule and re.fullmatch(rule['pattern'], value) is None):
                raise Rejected('invalid_schema')
        elif kind == 'array':
            if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
                raise Rejected('invalid_schema')
        else:
            raise Rejected('unsupported_schema')
    data = snapshot.get('data', {})
    try:
        for collection in ('hosts', 'srs', 'networks', 'templates'):
            names = [item['name'] for item in data[collection]]
            if len(set(names)) != len(names):
                raise Rejected('ambiguous_snapshot')
        for field, collection in [('template', 'templates'), ('network', 'networks'), ('sr', 'srs')]:
            if spec[field] not in {r['name'] for r in data[collection]}:
                raise Rejected('unknown_' + field)
        if spec['name'] in {v['name'] for v in data['recent_vms']}:
            raise Rejected('name_collision')
        hosts = data['hosts']
        if 'host' in spec:
            hosts = [h for h in hosts if h['name'] == spec['host']]
            if not hosts:
                raise Rejected('unknown_host')
        sr = next(r for r in data['srs'] if r['name'] == spec['sr'])
        if sr['free_gb'] < spec['disk_gb']:
            raise Rejected('insufficient_storage')
        possible = [h for h in hosts if h['cpus'] >= spec['vcpus'] and h['memory_free_mb'] >= spec['memory_mb'] and (sr['shared'] or sr['host'] == h['name'])]
        if not possible:
            raise Rejected('no_feasible_host')
    except (KeyError, TypeError, StopIteration):
        raise Rejected('invalid_snapshot')
    # Fully resolve an omitted host before presenting the immutable proposal.
    return {**spec, 'host': sorted(h['name'] for h in possible)[0] if 'host' not in spec else spec['host']}


class Proposals:
    def __init__(self, database, *, daily_quota=10, ttl=300, clock=time.time):
        if type(daily_quota) is not int or daily_quota < 1 or not 1 <= ttl <= 3600:
            raise ValueError('invalid proposal policy')
        path = Path(database)
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if path.parent.stat().st_mode & 0o077 or path.parent.stat().st_uid != os.getuid():
            raise ValueError('proposal state requires a private owned directory')
        if path.exists() and (path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077 or path.stat().st_uid != os.getuid()):
            raise ValueError('proposal database must be a private owned regular file')
        fd = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0), 0o600); os.close(fd)
        self.db = sqlite3.connect(path, timeout=5, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS proposals(
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, session TEXT NOT NULL,
            request TEXT NOT NULL, spec TEXT NOT NULL, digest TEXT NOT NULL,
            snapshot_digest TEXT NOT NULL, created REAL NOT NULL, expires REAL NOT NULL,
            status TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS audit(
            seq INTEGER PRIMARY KEY, at REAL NOT NULL, owner TEXT NOT NULL,
            session TEXT NOT NULL, proposal_id TEXT, event TEXT NOT NULL, detail TEXT NOT NULL);
        ''')
        self.quota, self.ttl, self.clock = daily_quota, ttl, clock

    def close(self):
        self.db.close()

    @contextmanager
    def transaction(self):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            yield
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise

    def actor(self, owner, session):
        if not all(isinstance(x, str) and 0 < len(x) <= 256 for x in (owner, session)):
            raise Rejected('invalid_identity')

    def event(self, owner, session, ident, event, detail):
        self.db.execute('INSERT INTO audit(at,owner,session,proposal_id,event,detail) VALUES(?,?,?,?,?,?)',
                        (self.clock(), owner, session, ident, event, canonical(detail)))

    def used(self, owner, now):
        day = int(now // 86400) * 86400
        return self.db.execute("SELECT count(*) FROM audit WHERE owner=? AND event='approved_dry_run' AND at>=? AND at<?", (owner, day, day + 86400)).fetchone()[0]

    def public(self, row):
        return {'id': row['id'], 'spec': json.loads(row['spec']), 'digest': row['digest'],
                'expires_at': row['expires'], 'status': row['status'], 'mode': 'propose_only',
                'created': False, 'live_execution_available': False}

    def propose(self, owner, session, request, spec, snapshot, *, replaces=None):
        self.actor(owner, session)
        if not isinstance(request, str) or not 0 < len(request) <= 16384:
            raise Rejected('invalid_request')
        now = self.clock()
        try:
            resolved = validate(spec, snapshot, now)
        except Rejected as error:
            with self.transaction():
                if replaces:
                    self.db.execute("UPDATE proposals SET status='invalidated' WHERE id=? AND owner=? AND session=? AND status='pending'", (replaces, owner, session))
                self.event(owner, session, None, 'preflight_rejected', {'reason': str(error), 'request': request})
            raise
        encoded = canonical(resolved)
        digest = hashlib.sha256(encoded.encode()).hexdigest()
        snapshot_digest = hashlib.sha256(canonical(snapshot).encode()).hexdigest()
        ident = secrets.token_urlsafe(32)
        failure = None
        with self.transaction():
            if self.used(owner, now) >= self.quota:
                failure = 'daily_quota'
            pending = self.db.execute("SELECT count(*) FROM proposals WHERE owner=? AND status='pending' AND expires>?", (owner, now)).fetchone()[0]
            if pending >= 10 and not replaces:
                failure = failure or 'pending_limit'
            if replaces:
                row = self.db.execute('SELECT * FROM proposals WHERE id=? AND owner=? AND session=?', (replaces, owner, session)).fetchone()
                if row is None or row['status'] != 'pending':
                    failure = failure or 'proposal_unavailable'
                elif failure:
                    self.db.execute("UPDATE proposals SET status='invalidated' WHERE id=?", (replaces,))
                elif not failure:
                    self.db.execute("UPDATE proposals SET status='superseded' WHERE id=?", (replaces,))
                    self.event(owner, session, replaces, 'superseded', {'replacement_id': ident})
            if failure:
                self.event(owner, session, None, 'preflight_rejected', {'reason': failure, 'request': request})
            else:
                self.db.execute('INSERT INTO proposals VALUES(?,?,?,?,?,?,?,?,?,?)',
                                (ident, owner, session, request, encoded, digest, snapshot_digest, now, now + self.ttl, 'pending'))
                self.event(owner, session, ident, 'proposed', {'request': request, 'spec': resolved, 'digest': digest, 'snapshot_digest': snapshot_digest})
        if failure:
            raise Rejected(failure)
        return self.get(owner, session, ident)

    def get(self, owner, session, ident):
        self.actor(owner, session)
        row = self.db.execute('SELECT * FROM proposals WHERE id=? AND owner=? AND session=?', (ident, owner, session)).fetchone()
        if row is None:
            raise Rejected('proposal_unavailable')
        return self.public(row)

    def decide(self, owner, session, ident, decision, snapshot=None):
        self.actor(owner, session)
        if decision not in ('approve', 'reject'):
            raise Rejected('invalid_decision')
        now, failure, result = self.clock(), None, None
        with self.transaction():
            row = self.db.execute('SELECT * FROM proposals WHERE id=? AND owner=? AND session=?', (ident, owner, session)).fetchone()
            if row is None or row['status'] != 'pending':
                failure = 'proposal_unavailable'
            elif now >= row['expires']:
                failure = 'proposal_expired'
                self.db.execute("UPDATE proposals SET status='expired' WHERE id=?", (ident,))
            elif decision == 'reject':
                self.db.execute("UPDATE proposals SET status='rejected' WHERE id=?", (ident,))
                self.event(owner, session, ident, 'rejected', {'digest': row['digest']})
            else:
                if self.used(owner, now) >= self.quota:
                    failure = 'daily_quota'
                else:
                    try:
                        current = validate(json.loads(row['spec']), snapshot, now)
                        if canonical(current) != row['spec']:
                            raise Rejected('spec_changed')
                    except Rejected as error:
                        failure = str(error)
                if failure:
                    self.db.execute("UPDATE proposals SET status='invalidated' WHERE id=?", (ident,))
                else:
                    self.db.execute("UPDATE proposals SET status='approved_dry_run' WHERE id=?", (ident,))
                    self.event(owner, session, ident, 'approved_dry_run', {'request': row['request'], 'spec': json.loads(row['spec']),
                               'digest': row['digest'], 'preflight_snapshot_digest': row['snapshot_digest'],
                               'approval_snapshot_digest': hashlib.sha256(canonical(snapshot).encode()).hexdigest(), 'created': False})
            if failure:
                self.event(owner, session, ident, 'decision_rejected', {'reason': failure})
            else:
                result = self.public(self.db.execute('SELECT * FROM proposals WHERE id=?', (ident,)).fetchone())
        if failure:
            raise Rejected(failure)
        return result
