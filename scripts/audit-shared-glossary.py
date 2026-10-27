#!/usr/bin/env python3
"""Compare pinned documentation terminology with patched XO5 UI messages.

Produces editorial review work, not approvals or replacement locale catalogs.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parent
LOCALES = ('en', 'fr', 'ja')
SOURCE = 'Vagrantin/xcp-hl/site/data/xoa_glossary.json'
spec = importlib.util.spec_from_file_location('ui_audit', ROOT / 'audit-ui-translations.py')
ui_audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui_audit)


def read_source(path):
    source = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(source, dict) or type(source.get('schemaVersion')) is not int or source['schemaVersion'] != 1:
        raise ValueError('source pin must use schemaVersion 1')
    if source.get('repository') != 'Vagrantin/xcp-hl':
        raise ValueError('source repository must be Vagrantin/xcp-hl')
    if not re.fullmatch(r'[0-9a-f]{40}', source.get('commit', '') if isinstance(source.get('commit'), str) else ''):
        raise ValueError('source commit must be a full immutable SHA')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', source.get('glossaryRevision', '') if isinstance(source.get('glossaryRevision'), str) else ''):
        raise ValueError('source glossaryRevision must be a SHA-256 identity')
    return source


def glossary_terms(export, source):
    if not isinstance(export, dict) or type(export.get('schemaVersion')) is not int or export['schemaVersion'] != 1:
        raise ValueError('export must use schemaVersion 1')
    if export.get('source') != SOURCE or export.get('locales') != list(LOCALES):
        raise ValueError('export source/locales do not match the shared glossary contract')
    terms = export.get('terms')
    if not isinstance(terms, list) or not terms:
        raise ValueError('export must contain terms')
    glossary = {}
    for term in terms:
        if not isinstance(term, dict) or not isinstance(term.get('id'), str) or not term['id'].strip() or term['id'] in glossary:
            raise ValueError('export has an invalid or duplicate term ID')
        translations = term.get('translations')
        if not isinstance(translations, dict) or set(translations) != set(LOCALES):
            raise ValueError(f"{term['id']}: expected EN/FR/JA terminology")
        for locale in LOCALES:
            fields = translations[locale]
            if not isinstance(fields, dict) or any(not isinstance(fields.get(k), str) or not fields[k].strip() for k in ('label', 'definition')):
                raise ValueError(f"{term['id']}: incomplete {locale} terminology")
        glossary[term['id']] = translations
    if list(glossary) != sorted(glossary):
        raise ValueError('export term IDs must be sorted')
    canonical = json.dumps(glossary, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    revision = 'sha256:' + hashlib.sha256(canonical.encode()).hexdigest()
    if revision != export.get('glossaryRevision') or revision != source['glossaryRevision']:
        raise ValueError('export content/revision differs from the committed source pin')
    return glossary


def build_report(export, mapping, source, xo_source, docs_commit, xoa_commit, xo_commit):
    if docs_commit != source['commit']:
        raise ValueError('checked-out documentation commit differs from the source pin')
    if any(not isinstance(sha, str) or not re.fullmatch(r'[0-9a-f]{40}', sha) for sha in (xoa_commit, xo_commit)):
        raise ValueError('XOA-HL and upstream XO identities must be full commit SHAs')
    glossary = glossary_terms(export, source)
    if not isinstance(mapping, dict) or type(mapping.get('schemaVersion')) is not int or mapping['schemaVersion'] != 1:
        raise ValueError('mapping must use schemaVersion 1')
    terms = mapping.get('terms')
    if not isinstance(terms, dict) or set(terms) != set(glossary):
        raise ValueError('mapping must account for every shared glossary ID exactly')
    catalog = xo_source / 'packages/xo-web/src/common/intl'
    sources = {'en': (catalog / 'messages.js').read_text(encoding='utf-8')}
    for locale in LOCALES[1:]:
        sources[locale] = (catalog / 'locales' / f'{locale}.js').read_text(encoding='utf-8')
    rows = []
    gaps = []
    for term_id in sorted(terms):
        term = terms[term_id]
        if not isinstance(term, dict) or not isinstance(term.get('context'), str) or not term['context'].strip():
            raise ValueError(f'{term_id}: mapping needs a review context or non-mapping reason')
        keys = term.get('keys')
        if not isinstance(keys, list) or any(not isinstance(key, str) or not re.fullmatch(r'[A-Za-z]\w*', key) for key in keys) or len(set(keys)) != len(keys):
            raise ValueError(f'{term_id}: mapping keys must be distinct catalog IDs')
        for key in keys:
            reference = ui_audit.string_value(sources['en'], key)
            occurrences = re.findall(rf'^  {re.escape(key)}:', sources['en'], re.MULTILINE)
            if len(occurrences) != 1 or reference is None or not reference[1:-1].strip():
                raise ValueError(f'{term_id}: {key} is not a unique nonempty English catalog message')
        for locale in LOCALES:
            messages = []
            for key in keys:
                source_text = sources[locale]
                occurrences = re.findall(rf'^  {re.escape(key)}:', source_text, re.MULTILINE)
                literal = ui_audit.string_value(source_text, key)
                if not occurrences:
                    status = 'missing'
                elif len(occurrences) != 1:
                    status = 'duplicate'
                elif literal is None:
                    status = 'untranslated-or-non-string'
                elif not literal[1:-1].strip():
                    status = 'empty'
                else:
                    status = 'present'
                message = {'key': key, 'catalogStatus': status, 'messageLiteral': literal}
                messages.append(message)
                if status != 'present':
                    gaps.append({'termId': term_id, 'locale': locale, **message})
            rows.append({
                'termId': term_id, 'locale': locale, **glossary[term_id][locale],
                'context': term['context'], 'messages': messages,
                'reviewStatus': 'pending' if keys else 'not-mapped',
            })
    return {
        'schemaVersion': 1,
        'documentation': {**source, 'exportSource': SOURCE},
        'xoaCommit': xoa_commit, 'xoCommit': xo_commit,
        'catalogState': 'patched XO5 source; installed UI not verified',
        'scope': 'Mapped EN/FR/JA terminology only; no human approval or full-interface coverage claim',
        'terms': rows, 'catalogGaps': gaps,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-pin', type=Path, default=ROOT / 'ui-glossary-source.json')
    parser.add_argument('--mapping', type=Path, default=ROOT / 'ui-glossary-map.json')
    parser.add_argument('--print-docs-commit', action='store_true')
    parser.add_argument('--export', type=Path)
    parser.add_argument('--xo-source', type=Path)
    parser.add_argument('--docs-commit')
    parser.add_argument('--xoa-commit')
    parser.add_argument('--xo-commit')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        source = read_source(args.source_pin)
        if args.print_docs_commit:
            print(source['commit'])
            return 0
        if any(value is None for value in (args.export, args.xo_source, args.docs_commit, args.xoa_commit, args.xo_commit, args.output)):
            parser.error('export, xo-source, docs-commit, xoa-commit, xo-commit and output are required')
        report = build_report(json.loads(args.export.read_text(encoding='utf-8')),
                              json.loads(args.mapping.read_text(encoding='utf-8')), source,
                              args.xo_source, args.docs_commit, args.xoa_commit, args.xo_commit)
    except (ValueError, OSError) as error:
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps({'schemaVersion': 1, 'fatalError': str(error)}, indent=2) + '\n', encoding='utf-8')
        print(f'ERROR: {error}')
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"PASS: {len(report['terms'])} term/locale comparisons; {len(report['catalogGaps'])} catalog gaps; human terminology review pending")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
