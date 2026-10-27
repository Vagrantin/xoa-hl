import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('history', Path(__file__).resolve().parents[1] / 'SOURCES/xoa-hl-update-history.py')
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)

class HistoryTest(unittest.TestCase):
    def test_changes_and_retention(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'history.json'
            for number in range(7):
                history.record(path, {'result': 'succeeded', 'number': number}, {'a': '1', 'gone': '1'}, {'a': '2', 'new': '1'})
            rows = json.loads(path.read_text())
            self.assertEqual([r['number'] for r in rows], [6, 5, 4, 3, 2])
            self.assertEqual(rows[0]['packages'], [
                {'name': 'a', 'previousVersion': '1', 'version': '2'},
                {'name': 'gone', 'previousVersion': '1', 'version': None},
                {'name': 'new', 'previousVersion': None, 'version': '1'},
            ])
            history.record(path, {'result': 'check_failed'}, None, None)
            self.assertFalse(json.loads(path.read_text())[0]['packagesKnown'])

    def test_corrupt_history_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'history.json'
            path.write_text('broken')
            with self.assertRaises(ValueError): history.record(path, {}, {}, {})
            self.assertEqual(path.read_text(), 'broken')

if __name__ == '__main__': unittest.main()
