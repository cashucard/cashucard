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
    def test_control_constructor_unchanged_and_pool_is_the_only_install_addition(self):
        original = (m.ROOT / 'applet/src/main/java/me/flashapp/cashu/CashuApplet.java').read_text()
        def constructor(source):
            start = source.index('    private CashuApplet() {')
            return source[start:source.index('\n    /**', start)]
        control = m.source_probe(original, 0)
        pool = m.source_probe(original, 16384)
        self.assertEqual(constructor(original), constructor(control))
        self.assertEqual(constructor(original), constructor(pool).replace(
            '\n        probePool = new byte[(short) 16384];', ''))
        for generated in [control, pool]:
            self.assertNotIn('getAvailableMemory', constructor(generated))
            self.assertNotIn('new short[', generated)
            self.assertEqual(original.count('JCSystem.makeTransient'), generated.count('JCSystem.makeTransient'))
        for size in [-1, 255, 257, 32768]:
            with self.assertRaises(ValueError):
                m.source_probe(original, size)
        with self.assertRaises(ValueError):
            m.source_probe(original.replace('schnorrHW.init();', 'changed();'), 16384)

    def test_queries_are_post_install_and_control_has_no_dummy_mutation(self):
        for size in [0, 16384]:
            process = m.process_probe(size)
            self.assertNotIn('new ', process)
            self.assertIn('JCSystem.getAvailableMemory(JCSystem.MEMORY_TYPE_PERSISTENT)', process)
            for handler in ['handleSpend', 'handleLoad', 'handleVerifyPin', 'handleReset']:
                self.assertNotIn(handler, process)
            self.assertEqual('JCSystem.beginTransaction()' in process, size != 0)
            self.assertEqual('JCSystem.abortTransaction()' in process, size != 0)

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
