import importlib.util
from pathlib import Path
import re
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
s=importlib.util.spec_from_file_location('compact',Path(__file__).with_name('build-compact.py'))
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

class CompactGeneration(unittest.TestCase):
    def test_original_fields_constructor_and_transient_budget_preserved(self):
        source=(ROOT/'applet/src/main/java/me/flashapp/cashu/CashuApplet.java').read_text()
        generated=m.source_compact(source)
        constructor=lambda text: text[text.index('    private CashuApplet() {'):text.index('\n    /**',text.index('    private CashuApplet() {'))]
        self.assertEqual(constructor(source),constructor(generated))
        fields=lambda text: text[:text.index('    public static void install(')]
        self.assertEqual(fields(source),fields(generated))
        self.assertEqual(source.count('JCSystem.makeTransient'),generated.count('JCSystem.makeTransient'))
        dispatch=generated[generated.index('    public void process(APDU apdu) {'):]
        self.assertNotIn('CompactCut',dispatch)
        handler=dispatch[:dispatch.index('    private short compactReceive(')]
        self.assertEqual(len(re.findall(r'\bnew\s+',handler)),2)
        self.assertLess(dispatch.index('cardLocked[0] = 1;'),dispatch.index('new byte[(short) 12288]'))
        self.assertIn('cardReceipts = new byte[(short) 16384];',dispatch)
        for code in ['processLoadProof(apdu)','processSetCard(apdu)','processResetCard(apdu)']:
            self.assertNotIn(code,dispatch[:dispatch.index('    private short compactReceive(')])
        with self.assertRaises(ValueError):m.source_compact(source.replace('schnorrHW.init();','changed();'))
    def test_helper_has_only_primitive_constants_and_no_allocation(self):
        source=(Path(__file__).parent/'java/CompactState.java').read_text()
        stripped=re.sub(r'/\*.*?\*/|//[^\n]*','',source,flags=re.S)
        self.assertNotRegex(stripped,r'\bnew\s+')
        self.assertNotRegex(stripped,r'\b(?:String|int|long|Object)\b')
        self.assertNotIn('static final byte[]',source)
        self.assertIn('SIM-CUT published',source)
        self.assertIn('SIM-CUT releasing',source)
    def test_artifact_paths_and_commands_are_offline(self):
        with tempfile.TemporaryDirectory() as t:
            out=Path(t)/'compact';m.prepare(out)
            build=(out/'build.xml').read_text()
            self.assertIn(m.PACKAGE,build)
            self.assertNotIn('target name="install"',build)
            self.assertNotIn('CompactCut', ''.join(p.read_text() for p in (out/'src').rglob('*.java')))
            with self.assertRaises(FileExistsError):m.prepare(out)

if __name__=='__main__':unittest.main()
