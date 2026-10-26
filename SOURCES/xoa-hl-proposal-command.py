#!/usr/bin/env python3
"""Private XO bridge command. Not an MCP tool or a network service."""
import importlib.util
import json
import os
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('create_mcp', HERE / 'xoa-hl-create-mcp.py')
mcp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mcp)
MAX_INPUT = mcp.MAX_INVENTORY + 65536
DATABASE = Path('/var/lib/xoa-hl/assistant/proposals.sqlite')


def execute(message, store):
    if not isinstance(message, dict):
        raise ValueError('invalid command')
    action = message.get('action')
    extra = {'begin': {'request'}, 'revoke': {'turn_id', 'reason'}, 'get': {'id'},
             'decide': {'id', 'decision', 'snapshot'}}.get(action)
    if extra is None or set(message) != {'owner', 'session', 'action'} | extra:
        raise ValueError('invalid command')
    owner, session = message['owner'], message['session']
    store.actor(owner, session)
    if action == 'begin':
        return {'turn_id': store.begin_turn(owner, session, message['request'])}
    if action == 'revoke':
        changed = store.revoke_turn(owner, session, message['turn_id'], message['reason'])
        return {'revoked': changed}
    if not isinstance(message['id'], str) or not 1 <= len(message['id']) <= 256:
        raise ValueError('invalid proposal')
    if action == 'get':
        return store.get(owner, session, message['id'])
    return store.decide(owner, session, message['id'], message['decision'], message['snapshot'])


def serve(source, destination, database=DATABASE):
    # One request per process; no unbounded stream, path argument or credential.
    try:
        raw = source.read(MAX_INPUT + 1)
        if len(raw) > MAX_INPUT:
            raise ValueError('command too large')
        message = mcp.decode(raw)
        store = mcp.proposals.Proposals(database)
        try:
            result = execute(message, store)
        finally:
            store.close()
        output = {'ok': True, 'result': result}
    except Exception:
        # The caller reconciles unavailable/terminal plans via get. Neither
        # adapter details, SQLite paths nor request text enter error output.
        output = {'ok': False, 'error': 'proposal_unavailable'}
    destination.write((json.dumps(output, ensure_ascii=False, allow_nan=False) + '\n').encode())
    destination.flush()


if __name__ == '__main__':
    os.umask(0o077)
    serve(sys.stdin.buffer, sys.stdout.buffer)
