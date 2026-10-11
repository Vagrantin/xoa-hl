#!/usr/bin/env python3
"""Regression checks for shared terminology provenance and visible review gaps."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('shared_glossary', ROOT / 'scripts/audit-shared-glossary.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class SharedGlossaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        catalog = self.root / 'packages/xo-web/src/common/intl'
        (catalog / 'locales').mkdir(parents=True)
        (catalog / 'messages.js').write_text("  vm: 'VM',\n", encoding='utf-8')
        (catalog / 'locales/fr.js').write_text("  vm: 'Machine virtuelle',\n", encoding='utf-8')
        (catalog / 'locales/ja.js').write_text("  vm: '仮想マシン',\n", encoding='utf-8')
        self.glossary = {term: {lang: {'label': label, 'definition': 'Meaning'} for lang, label in
                               [('en', 'VM'), ('fr', 'Machine virtuelle'), ('ja', '仮想マシン')]} for term in ('vm', 'xo-lite')}
        digest = hashlib.sha256(json.dumps(self.glossary, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        self.source = {'schemaVersion': 1, 'repository': 'Vagrantin/xcp-hl', 'commit': 'a' * 40, 'glossaryRevision': 'sha256:' + digest}
        self.export = {'schemaVersion': 1, 'source': audit.SOURCE, 'locales': list(audit.LOCALES),
                       'glossaryRevision': self.source['glossaryRevision'],
                       'terms': [{'id': key, 'translations': self.glossary[key]} for key in sorted(self.glossary)]}
        self.mapping = {'schemaVersion': 1, 'terms': {'vm': {'keys': ['vm'], 'context': 'Object type'},
                                                     'xo-lite': {'keys': [], 'context': 'Separate product'}}}

    def report(self, **changes):
        args = dict(export=self.export, mapping=self.mapping, source=self.source, xo_source=self.root,
                    docs_commit='a' * 40, xoa_commit='b' * 40, xo_commit='c' * 40)
        args.update(changes)
        return audit.build_report(**args)

    def test_unicode_provenance_and_pending_review(self):
        report = self.report()
        self.assertEqual(report['documentation']['commit'], 'a' * 40)
        self.assertEqual(report['xoCommit'], 'c' * 40)
        self.assertEqual(report['xoaCommit'], 'b' * 40)
        self.assertEqual(len(report['terms']), 6)
        self.assertFalse(report['catalogGaps'])
        row = next(r for r in report['terms'] if r['termId'] == 'vm' and r['locale'] == 'ja')
        self.assertEqual(row['messages'][0]['messageLiteral'], "'仮想マシン'")
        self.assertEqual(row['reviewStatus'], 'pending')
        self.assertEqual({r['reviewStatus'] for r in report['terms']}, {'pending', 'not-mapped'})

    def test_missing_and_undefined_are_visible_without_english_fallback(self):
        catalog = self.root / 'packages/xo-web/src/common/intl/locales'
        (catalog / 'fr.js').write_text('// absent\n', encoding='utf-8')
        (catalog / 'ja.js').write_text('  vm: undefined,\n', encoding='utf-8')
        gaps = self.report()['catalogGaps']
        self.assertEqual([r['catalogStatus'] for r in gaps], ['missing', 'untranslated-or-non-string'])
        self.assertTrue(all(r['messageLiteral'] is None for r in gaps))

    def test_duplicate_and_empty_locale_messages_are_gaps(self):
        catalog = self.root / 'packages/xo-web/src/common/intl/locales'
        (catalog / 'fr.js').write_text("  vm: 'VM',\n  vm: 'VM',\n", encoding='utf-8')
        (catalog / 'ja.js').write_text("  vm: '',\n", encoding='utf-8')
        self.assertEqual([r['catalogStatus'] for r in self.report()['catalogGaps']], ['duplicate', 'empty'])

    def test_changed_content_and_export_identity_fail(self):
        self.export['terms'][0]['translations']['ja']['label'] = 'Changed'
        with self.assertRaisesRegex(ValueError, 'content/revision'):
            self.report()
        self.export['source'] = 'another source'
        with self.assertRaisesRegex(ValueError, 'source/locales'):
            self.report()

    def test_wrong_checkout_commit_fails(self):
        with self.assertRaisesRegex(ValueError, 'documentation commit'):
            self.report(docs_commit='d' * 40)

    def test_mapping_must_cover_terms_and_use_real_english_ids(self):
        del self.mapping['terms']['xo-lite']
        with self.assertRaisesRegex(ValueError, 'every shared glossary ID'):
            self.report()
        self.mapping['terms']['xo-lite'] = {'keys': ['imaginaryMessage'], 'context': 'Invalid ID'}
        with self.assertRaisesRegex(ValueError, 'English catalog message'):
            self.report()

    def test_source_pin_rejects_moving_refs_and_boolean_schema(self):
        path = self.root / 'pin.json'
        path.write_text(json.dumps(self.source), encoding='utf-8')
        self.assertEqual(audit.read_source(path), self.source)
        for field, value in [('commit', 'main'), ('schemaVersion', True), ('repository', 'Vagrantin/xoa-hl')]:
            data = {**self.source, field: value}
            path.write_text(json.dumps(data), encoding='utf-8')
            with self.subTest(field=field), self.assertRaises(ValueError):
                audit.read_source(path)

    def test_duplicate_export_ids_and_incomplete_locales_fail(self):
        self.export['terms'].append(self.export['terms'][0])
        with self.assertRaisesRegex(ValueError, 'duplicate term ID'):
            self.report()
        self.export['terms'].pop()
        del self.export['terms'][0]['translations']['ja']['definition']
        with self.assertRaisesRegex(ValueError, 'incomplete ja'):
            self.report()

    def test_failed_cli_writes_fatal_artifact(self):
        pin = self.root / 'pin.json'
        pin.write_text(json.dumps(self.source), encoding='utf-8')
        export = self.root / 'export.json'
        export.write_text('{}', encoding='utf-8')
        mapping = self.root / 'map.json'
        mapping.write_text(json.dumps(self.mapping), encoding='utf-8')
        output = self.root / 'review/report.json'
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/audit-shared-glossary.py'),
                                 '--source-pin', str(pin), '--mapping', str(mapping), '--export', str(export),
                                 '--xo-source', str(self.root), '--docs-commit', 'a' * 40,
                                 '--xoa-commit', 'b' * 40, '--xo-commit', 'c' * 40, '--output', str(output)],
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('fatalError', json.loads(output.read_text(encoding='utf-8')))


if __name__ == '__main__':
    unittest.main()
