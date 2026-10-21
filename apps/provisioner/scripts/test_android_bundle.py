"""Focused artifact invariants; actual native builds exercise the tool boundary."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('bundle', Path(__file__).with_name('check-android-bundle.py'))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class BundleChecks(unittest.TestCase):
    def test_manifest_rejects_previous_compile_sdk_and_debuggable_release(self):
        def xml(compile_sdk=36, debug='false'):
            return f'''<manifest xmlns:android="http://schemas.android.com/apk/res/android"
                package="com.islandbitcoin.provisioner" android:compileSdkVersion="{compile_sdk}">
                <uses-sdk android:targetSdkVersion="36"/>
                <application android:debuggable="{debug}"/></manifest>'''
        self.assertEqual(bundle.check_manifest(xml())['compile_sdk'], 36)
        with self.assertRaises(ValueError):
            bundle.check_manifest(xml(35))
        with self.assertRaises(ValueError):
            bundle.check_manifest(xml(debug='true'))

    def test_each_elf_load_segment_needs_16kb_alignment_and_congruence(self):
        good = 'LOAD 0x004000 0x008000 0x008000 0x1000 0x1000 R E 0x4000'
        bundle.check_loads(good)
        for bad in ('', good.replace('0x4000', '0x1000'),
                    good.replace('0x004000', '0x004001'),
                    good + '\n' + good.replace('0x4000', '0x1000')):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                bundle.check_loads(bad)


if __name__ == '__main__':
    unittest.main()
