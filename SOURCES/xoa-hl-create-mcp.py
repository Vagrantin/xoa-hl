#!/usr/bin/env python3
"""One-tool propose-only MCP extension. Context is supplied on a private FD."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import socket
import stat
import sys

HERE = Path(__file__).resolve().parent
module = importlib.util.spec_from_file_location('xoa_proposals', HERE / 'xoa-hl-proposals.py')
proposals = importlib.util.module_from_spec(module)
module.loader.exec_module(proposals)
MAX_MESSAGE = 131072
MAX_INVENTORY = 8 * 1024 * 1024


def decode(line):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate key')
            result[key] = value
        return result
    def nonfinite(value):
        raise ValueError('nonfinite number')
    return json.loads(line, object_pairs_hook=unique, parse_constant=nonfinite)


def private_socket(path):
    path = Path(path)
    if not path.is_absolute():
        raise ValueError('absolute socket path required')
    parent, entry = path.parent.stat(), path.lstat()
    if parent.st_uid != os.getuid() or parent.st_mode & 0o077 or entry.st_uid != os.getuid() or entry.st_mode & 0o077 or not stat.S_ISSOCK(entry.st_mode):
        raise ValueError('inventory socket must be private and owned')
    return str(path)


def inventory(path):
    """The socket belongs to a trusted, caller-scoped live inventory adapter."""
    with socket.socket(socket.AF_UNIX) as peer:
        peer.settimeout(5)
        peer.connect(private_socket(path))
        peer.sendall(b'{"method":"inventory","version":2}\n')
        with peer.makefile('rb') as stream:
            raw = stream.readline(MAX_INVENTORY + 1)
        if len(raw) > MAX_INVENTORY or not raw.endswith(b'\n'):
            raise ValueError('invalid inventory frame')
        result = decode(raw)
        if not isinstance(result, dict):
            raise ValueError('invalid inventory response')
        return result


def context_from_fd(fd):
    # No context, credential, owner or session may come from MCP arguments.
    with os.fdopen(os.dup(fd), 'rb') as stream:
        raw = stream.read(MAX_MESSAGE + 1)
    if len(raw) > MAX_MESSAGE:
        raise ValueError('context too large')
    result = decode(raw)
    if not isinstance(result, dict) or set(result) != {'owner', 'session', 'request', 'database', 'inventory_socket', 'turn_id'}:
        raise ValueError('invalid context')
    if not all(isinstance(value, str) and value for value in result.values()) or not Path(result['database']).is_absolute():
        raise ValueError('invalid context fields')
    private_socket(result['inventory_socket'])
    return result


class Extension:
    def __init__(self, store, *, owner, session, request, turn_id, read_inventory):
        store.actor(owner, session)
        if not isinstance(request, str) or not 0 < len(request) <= 16384:
            raise ValueError('invalid request')
        self.store, self.owner, self.session = store, owner, session
        self.request, self.read_inventory, self.turn_id = request, read_inventory, turn_id
        store.assert_turn(owner, session, turn_id, request)
        self.initialized = False
        self.calls = 0
        # Only the trusted supervisor may start a turn. A stale worker cannot
        # mint a replacement turn or revoke a newer conversation's proposal.

    def handle(self, message):
        ident = message.get('id') if isinstance(message, dict) else None
        def reply(result=None, error=None):
            return {'jsonrpc': '2.0', 'id': ident, **({'error': error} if error else {'result': result})}
        if not isinstance(message, dict) or message.get('jsonrpc') != '2.0' or not isinstance(message.get('method'), str) or type(ident) not in (int, str, type(None)):
            return reply(error={'code': -32600, 'message': 'Invalid request'})
        method = message['method']
        if 'id' not in message:
            return None
        params = message.get('params', {})
        if not isinstance(params, dict):
            return reply(error={'code': -32602, 'message': 'Invalid parameters'})
        if method == 'initialize':
            if self.initialized:
                return reply(error={'code': -32600, 'message': 'Already initialized'})
            if params.get('protocolVersion') not in ('2024-11-05', '2025-03-26', '2025-06-18'):
                return reply(error={'code': -32602, 'message': 'Unsupported protocol version'})
            self.initialized = True
            return reply({'protocolVersion': params['protocolVersion'], 'capabilities': {'tools': {}},
                          'serverInfo': {'name': 'xoa-hl-create-proposal', 'version': '1.0.0'},
                          'instructions': 'Propose-only. Approval records a dry run. No VM is created.'})
        if not self.initialized:
            return reply(error={'code': -32000, 'message': 'Initialize first'})
        if method == 'ping':
            return reply({})
        if method == 'tools/list' and not params:
            return reply({'tools': [{'name': 'create_vm',
                'description': 'Validate a fully resolved VM specification against fresh inventory and propose it for human review. Propose-only: this tool never creates a VM.',
                'inputSchema': proposals.SCHEMA,
                'annotations': {'readOnlyHint': False, 'destructiveHint': False, 'idempotentHint': False, 'openWorldHint': False}}]})
        if method != 'tools/call':
            return reply(error={'code': -32601, 'message': 'Method not available'})
        if set(params) != {'name', 'arguments'} or params.get('name') != 'create_vm':
            return reply(error={'code': -32602, 'message': 'Only create_vm is available'})
        self.calls += 1
        try:
            self.store.invalidate_pending(self.owner, self.session, turn_id=self.turn_id)
            if self.calls > 6:
                raise proposals.Rejected('tool_call_limit')
            plan = self.store.propose(self.owner, self.session, self.request, params['arguments'], self.read_inventory(), turn_id=self.turn_id)
            result = {'content': [{'type': 'text', 'text': proposals.canonical(plan)}], 'isError': False}
        except proposals.Rejected as error:
            result = {'content': [{'type': 'text', 'text': proposals.canonical({'rejected': str(error), 'created': False})}], 'isError': True}
        except Exception:
            # Never expose the adapter's exception, token, inventory or DB path.
            result = {'content': [{'type': 'text', 'text': '{"rejected":"inventory_unavailable","created":false}'}], 'isError': True}
        return reply(result)


def serve(extension, source, destination):
    while True:
        line = source.readline(MAX_MESSAGE + 1)
        if not line:
            return
        if len(line) > MAX_MESSAGE or not line.endswith(b'\n'):
            return  # Fatal framing error; do not parse a truncated remainder.
        try:
            message = decode(line)
            result = extension.handle(message)
        except (ValueError, TypeError, RecursionError, UnicodeError):
            result = {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'Invalid JSON'}}
        if result is not None:
            destination.write((proposals.canonical(result) + '\n').encode())
            destination.flush()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--context-fd', type=int, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        context = context_from_fd(args.context_fd)
        store = proposals.Proposals(context['database'])
        try:
            extension = Extension(store, owner=context['owner'], session=context['session'], request=context['request'], turn_id=context['turn_id'],
                                  read_inventory=lambda: inventory(context['inventory_socket']))
            serve(extension, sys.stdin.buffer, sys.stdout.buffer)
        finally:
            store.close()
    except Exception:
        raise SystemExit('Propose-only MCP setup failed; check trusted local context')
