from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import subprocess
import shutil
import os
import tempfile
from types import SimpleNamespace
import unittest

spec=importlib.util.spec_from_file_location('identity',Path(__file__).resolve().parents[1]/'SOURCES/xoa-hl-publish-identity.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
NOW=datetime(2026,10,28,1,2,3,tzinfo=timezone.utc)
class Identity(unittest.TestCase):
    def run_case(self, image=None, legacy=None, version='5.113.2_e281c536-47.gca44911.xcpng8.3.el9', domid='42', clear=False, fail=False):
        calls=[]
        def run(args, **kwargs):
            calls.append(args)
            if fail and args[0]=='/bin/rpm': raise subprocess.CalledProcessError(1,args)
            return SimpleNamespace(stdout=domid if args[0]=='xenstore-read' else version)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'etc').mkdir()
            if image is not None:(root/'etc/xoa-hl-image-tag').write_text(image)
            if legacy is not None:(root/'etc/xoa-hl-vm-release').write_text(legacy)
            module.publish(clear,run,root,NOW)
        return calls

    def test_exact_image_and_installed_rpm(self):
        tag='xoa-image-20261028-010203000000001-abcdef0'
        calls=self.run_case(image=tag,legacy='built 2026-10-22, commit a280852, release v5.113.2_e281c536-ce40')
        value=json.loads(calls[-1][2]);self.assertEqual(value['image'],tag)
        self.assertEqual(value['application'],'5.113.2_e281c536-47.gca44911.xcpng8.3.el9')
        self.assertEqual(value['reported_at'],'2026-10-28T01:02:03Z')
        self.assertEqual(calls[-1][:2],['xenstore-write','control/xoa-hl-identity'])
        self.assertLessEqual(len(calls[-1][2]),1024)

    def test_legacy_image_stamp_is_retained(self):
        legacy='built 2026-10-22, commit a280852, release v5.113.2_e281c536-ce40'
        self.assertEqual(json.loads(self.run_case(legacy=legacy)[-1][2])['image'],legacy)

    def test_missing_or_unexpected_files_do_not_advertise_arbitrary_data(self):
        for image,legacy in [(None,None),('unrelated secret','unexpected content'),('x'*1000,'bad\nvalue')]:
            self.assertIsNone(json.loads(self.run_case(image=image,legacy=legacy)[-1][2])['image'])

    def test_dom0_is_never_written(self):
        self.assertEqual(len(self.run_case(domid='0')),1)

    def test_bad_domid_is_never_written(self):
        self.assertEqual(len(self.run_case(domid='not-a-domain')),1)

    def test_failed_rpm_query_does_not_publish(self):
        with self.assertRaises(subprocess.CalledProcessError):self.run_case(fail=True)

    def test_uninstall_removes_only_our_key(self):
        self.assertEqual(self.run_case(clear=True)[-1],['xenstore-rm','control/xoa-hl-identity'])

    def test_invalid_version_is_not_published(self):
        with self.assertRaises(ValueError):self.run_case(version='bad\nversion')

    def test_packaged_systemd_units_parse(self):
        analyzer=shutil.which('systemd-analyze')
        if analyzer is None:self.skipTest('systemd-analyze unavailable')
        sources=Path(__file__).resolve().parents[1]/'SOURCES'
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            helper=root/'publish-identity.py';helper.write_text((sources/'xoa-hl-publish-identity.py').read_text());helper.chmod(0o755)
            units=[]
            for name in ['xoa-hl-publish-identity.service','xoa-hl-publish-identity.timer']:
                path=root/name;path.write_text((sources/name).read_text().replace('/usr/libexec/xoa-hl/publish-identity.py',str(helper)));units.append(str(path))
            result=subprocess.run([analyzer,'verify',*units],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)

if __name__=='__main__':unittest.main()
