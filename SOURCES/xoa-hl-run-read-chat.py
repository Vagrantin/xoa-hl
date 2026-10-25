#!/usr/bin/env python3
"""Disabled-by-default local operator read-only entry point; no service/UI bridge."""
import argparse
import json
import os
from pathlib import Path
import shlex
import subprocess
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
READS = ['check_connection', 'list_pools', 'list_hosts', 'list_vms', 'list_srs', 'list_networks', 'get_infrastructure_summary']


def origin(value):
    if not isinstance(value, str):
        raise ValueError('endpoint required')
    url = urlsplit(value)
    if url.scheme not in ('http', 'https') or url.hostname not in ('127.0.0.1', 'localhost', '::1') or url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
        raise ValueError('endpoint must be a loopback origin')
    return value.rstrip('/')


def validate_config(config):
    keys = {'enabled', 'provider', 'model', 'endpoint', 'context_limit', 'xo_url', 'mcp_package'}
    if not isinstance(config, dict) or set(config) - keys or type(config.get('enabled')) is not bool:
        raise ValueError('invalid assistant configuration')
    if not config['enabled']:
        return False
    if config.get('provider') not in ('llama', 'ollama'):
        raise ValueError('select a local provider')
    if not isinstance(config.get('model'), str) or not config['model'].strip() or ':cloud' in config['model'].lower():
        raise ValueError('select an installed local model')
    origin(config.get('endpoint')); origin(config.get('xo_url'))
    if type(config.get('context_limit')) is not int or not 512 <= config['context_limit'] <= 32768:
        raise ValueError('set the measured context limit')
    path = config.get('mcp_package')
    if not isinstance(path, str) or not Path(path).is_absolute():
        raise ValueError('MCP package must be an absolute installed path')
    return True


def launch(args):
    config = json.loads(args.config.read_text())
    if not validate_config(config):
        print(json.dumps({'enabled': False}))
        return 3
    package = json.loads((Path(config['mcp_package']) / 'package.json').read_text())
    if package.get('name') != '@xen-orchestra/mcp' or package.get('version') != '1.1.0':
        raise ValueError('install the reviewed MCP version before enabling')
    if not os.environ.get('XO_TOKEN') and not (os.environ.get('XO_USERNAME') and os.environ.get('XO_PASSWORD')):
        raise ValueError('provide operator-scoped XO credentials in the environment')
    version = subprocess.check_output([str(args.goose), '--version'], text=True, timeout=10).strip()
    if version != '1.56.0':
        raise ValueError('unreviewed goose runtime version')
    if Path('/etc/goose/config.yaml').exists():
        raise ValueError('use a clean lab environment without system goose config')
    args.request_file.read_text()  # Validate before creating state or launching.
    state = args.state_dir.resolve()
    state.mkdir(mode=0o700, exist_ok=False)
    root = state / 'goose'; conf = root / 'config'; conf.mkdir(parents=True)
    home = state / 'home'; home.mkdir()
    work = state / 'work'; work.mkdir()
    def write(path, value):
        path.write_text(json.dumps(value, indent=2) + '\n')
    write(conf / 'config.yaml', {'GOOSE_MODE': 'approve', 'GOOSE_TELEMETRY_ENABLED': False, 'extensions': {}})
    write(conf / 'permission.yaml', {'user': {'always_allow': ['xoread__' + name for name in READS],
                                            'ask_before': [], 'never_allow': ['load_skill']}})
    endpoint = origin(config['endpoint'])
    provider = 'ollama'
    if config['provider'] == 'llama':
        provider = 'custom_xoa_local'
        directory = conf / 'custom_providers'; directory.mkdir()
        write(directory / 'custom_xoa_local.json', {'name': provider, 'engine': 'openai',
              'display_name': 'XOA-HL local operator', 'api_key_env': '',
              'base_url': endpoint + '/v1/chat/completions', 'requires_auth': False,
              'supports_streaming': True, 'skip_canonical_filtering': True,
              'models': [{'name': config['model'], 'context_limit': config['context_limit']}]})
    env = {'PATH': os.environ.get('PATH', ''), 'HOME': str(home), 'GOOSE_PATH_ROOT': str(root),
           'GOOSE_MODE': 'approve', 'GOOSE_TELEMETRY_OFF': '1', 'GOOSE_DISABLE_KEYRING': '1',
           'OLLAMA_HOST': endpoint, 'XO_URL': origin(config['xo_url']), 'NO_PROXY': '*'}
    for key in ['XO_TOKEN', 'XO_USERNAME', 'XO_PASSWORD', 'NODE_EXTRA_CA_CERTS']:
        if os.environ.get(key):
            env[key] = os.environ[key]
    extension = shlex.join([str(args.node), str(HERE / 'xoa-hl-mcp-read-proxy.mjs'), '--mcp-package', config['mcp_package']])
    recipe = json.loads((HERE / 'xoa-hl-read-chat.recipe.json').read_text())
    command = [str(args.goose), 'run', '--instructions', str(args.request_file.resolve()), '--system', recipe['instructions'],
               '--with-extension', 'xoread:' + extension, '--no-profile', '--no-session',
               '--provider', provider, '--model', config['model'], '--max-turns', str(recipe['settings']['max_turns']),
               '--output-format', 'stream-json']
    # Replace the launcher rather than leaving a supervisor to orphan the child.
    os.chdir(work)
    os.execve(str(args.goose), command, env)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path('/etc/xoa-hl/assistant.json'))
    parser.add_argument('--goose', type=Path, default=Path('/usr/libexec/xoa-hl/goose'))
    parser.add_argument('--node', type=Path, default=Path('/usr/bin/node'))
    parser.add_argument('--request-file', type=Path, required=True)
    parser.add_argument('--state-dir', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        raise SystemExit(launch(args))
    except (OSError, ValueError, subprocess.SubprocessError):
        # Configuration/credential values never go into startup error output.
        raise SystemExit('Read-only assistant setup failed; check local configuration and installed versions')
