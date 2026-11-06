"""Private diagnostic generation only; no card/reader imports."""
import importlib.util
from pathlib import Path
import re
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('trace_builder',HERE/'build-constructor-trace.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class TraceGeneration(unittest.TestCase):
    def test_instrumented_constructor_preserves_operations_and_field_shape(self):
        app=(m.ROOT/'applet/src/main/java/me/flashapp/cashu/CashuApplet.java').read_text()
        signer=(m.ROOT/'applet/src/main/java/me/flashapp/cashu/SchnorrHW.java').read_text()
        generated,stages=m.instrument(app,signer)
        self.assertEqual(app[:app.index('    public static void install(')],generated['CashuApplet.java'][:generated['CashuApplet.java'].index('    public static void install(')])
        self.assertGreater(len(stages),50);self.assertLess(len(stages),128)
        self.assertEqual([s['id'] for s in stages],list(range(1,len(stages)+1)))
        self.assertEqual(len({(s['file'],s['statement']) for s in stages}),len(stages))
        for file,source,declaration in [('CashuApplet.java',app,'    private CashuApplet()'),('SchnorrHW.java',signer,'    SchnorrHW(')]:
            original=m.statements(m.body(source,declaration)[2])
            for statement in original:self.assertIn(statement.strip(),generated[file])
        self.assertIn('catch (CardRuntimeException error)',generated['CashuApplet.java'])
        self.assertIn('ConstructorTrace.record(error);',generated['CashuApplet.java'])
        self.assertNotIn('catch (',m.body(generated['SchnorrHW.java'],'    SchnorrHW(')[2])
        with self.assertRaises(ValueError):m.instrument(app.replace('schnorrHW.init();','changed();'),signer)

    def test_dispatch_is_read_only_and_partial_instance_safe(self):
        with tempfile.TemporaryDirectory() as t:
            out=Path(t)/'image';stages=m.prepare(out)
            app=(out/'src/me/flashapp/cashu/CashuApplet.java').read_text()
            self.assertEqual(m.body(app,'    public boolean select()')[2].strip(),'return true;')
            self.assertEqual(m.body(app,'    public Shareable getShareableInterfaceObject(')[2].strip(),'return null;')
            dispatch=m.body(app,'    public void process(APDU apdu)')[2]
            self.assertIn('ConstructorTrace.reply(apdu);',dispatch)
            self.assertNotIn('CompactState',app)
            self.assertNotIn('new ',dispatch)
            self.assertNotIn('getMessage',app)
            helper=(out/'src/me/flashapp/cashu/ConstructorTrace.java').read_text()
            self.assertNotRegex(re.sub(r'/\*.*?\*/|//[^\n]*','',helper,flags=re.S),r'\bnew\s|arrayFillNonAtomic|beginTransaction|abortTransaction')
            build=(out/'build.xml').read_text()
            self.assertIn(m.PACKAGE,build);self.assertNotIn('target name="install"',build)
            self.assertGreater(len(stages),50)
            with self.assertRaises(FileExistsError):m.prepare(out)

    def test_parser_refuses_changed_constructor_nesting(self):
        with self.assertRaises(ValueError):m.statements('if (x) { new Object(); }')
        self.assertEqual(m.statements('a = call(1, 2);\n/* note */ b = new byte[(short) 2];'),['a = call(1, 2);','b = new byte[(short) 2];'])


if __name__=='__main__':unittest.main()
