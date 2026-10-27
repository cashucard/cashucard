"""The generated probe preserves installation and exposes only dummy operations."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

s = importlib.util.spec_from_file_location('probe', Path(__file__).with_name('build-probe.py'))
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)


class ProbeTest(unittest.TestCase):
    def test_install_path_and_runtime_boundary(self):
        original = (m.ROOT / 'applet/src/main/java/me/flashapp/cashu/CashuApplet.java').read_text()
        generated = m.source_probe(original, 16384)
        self.assertIn('probePool = new byte[(short) 16384]', generated)
        # Existing install-time allocations and transient demand are preserved.
        self.assertEqual(original.count('JCSystem.makeTransient'), generated.count('JCSystem.makeTransient'))
        process = generated[generated.index(m.PROCESS):][:len(m.PROCESS)]
        self.assertNotIn('new ', process)
        for handler in ['handleSpend', 'handleLoad', 'handleVerifyPin', 'handleReset']:
            self.assertNotIn(handler, process)
        self.assertIn('JCSystem.abortTransaction()', process)
        for size in [0, 255, 257, 32768]:
            with self.assertRaises(ValueError):
                m.source_probe(original, size)
        with self.assertRaises(ValueError):
            m.source_probe(original.replace('schnorrHW.init();', 'changed();'), 16384)

    def test_build_paths_and_aids_are_separate(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'probe'
            hashes = m.prepare(output, 16384)
            self.assertIn('CashuApplet.java', hashes)
            build = ET.parse(output / 'build.xml')
            cap = build.find("target[@name='cap']/javacard/cap")
            self.assertEqual(cap.get('aid'), m.PACKAGE)
            self.assertEqual(cap.get('version'), '0.0')
            self.assertEqual(build.getroot().get('basedir'), str(output))
            self.assertEqual(build.find("property[@name='cap.file']").get('value'), str(output / 'resource-probe.cap'))
            for name in ['install', 'delete', 'list', 'cap-debug', 'hello-cap', 'clean']:
                self.assertIsNone(build.find("target[@name='" + name + "']"))
            for applet in cap.findall('applet'):
                self.assertTrue(applet.get('aid').startswith(m.PACKAGE + ':'))
            with self.assertRaises(FileExistsError):
                m.prepare(output, 16384)


if __name__ == '__main__':
    unittest.main()
