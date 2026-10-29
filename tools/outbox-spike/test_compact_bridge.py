"""Offline policy tests; pyscard is not imported."""
import json
from pathlib import Path
import subprocess
import unittest
import compact_bridge as b

def wrapped(ins,p1,p2,body):return list(bytes([0x84,ins,p1,p2,len(body)+8])+body+bytes(9))

class CompactPolicy(unittest.TestCase):
    def test_exact_fixture_commands_match_node(self):
        text=subprocess.check_output(['node','-e',"const w=require('./compact-workload.cjs').workload();console.log(JSON.stringify([w.setup,...w.keysets,...w.loads,w.begin,w.outputs,require('./compact-workload.cjs').cmd(0x74),require('./compact-workload.cjs').cmd(0x7c,Buffer.from([0])),...w.pages]));"],cwd=Path(__file__).parent,text=True)
        self.assertEqual([bytes(a) for a in json.loads(text)],b.fixture_commands())
    def test_selection_and_single_attempt_limits_survive_reselection(self):
        p=b.Policy();setup=b.fixture_commands()[0]
        with self.assertRaises(ValueError):p.before(list(setup))
        select=b.common.select(b.PRIVATE[0]);p.after(select,list(b'CPROT\x02'),0x90,0)
        self.assertEqual(p.before(list(setup)),setup)
        p.after(select,list(b'CPROT\x02'),0x90,0)
        with self.assertRaises(ValueError):p.before(list(setup))
        with self.assertRaises(ValueError):p.before(list(b.cmd(0x77,bytes(45))))
        scope=bytes(range(45));p.after(b.cmd(0x74),list(scope),0x90,0)
        p.before(list(b.cmd(0x77,scope)))
        with self.assertRaises(ValueError):p.before(list(b.cmd(0x77,scope)))
    def test_cleanup_cannot_load_or_sign_and_production_management_is_refused(self):
        for aid in b.PRIVATE:b.validate(wrapped(0xe4,0,0,b'\x4f'+b.common.field(aid)),True)
        for command in b.fixture_commands():
            with self.assertRaises(ValueError):b.validate(list(command),True)
        for aid in [b.common.ISD]+b.common.PRODUCTION+b.OLD:
            with self.assertRaises(ValueError):b.validate(wrapped(0xe4,0,0,b'\x4f'+b.common.field(aid)))
        for command in [list(b.cmd(0x70,b.fixture_commands()[0][5:-1])),wrapped(0xd8,1,0x81,bytes(67)),list(b.cmd(0x20,b'123456')),list(b.cmd(0x71,bytes(75))),list(b.cmd(0x7e)),[True]]:
            with self.assertRaises(ValueError):b.validate(command)

if __name__=='__main__':unittest.main()
