"""Readiness policy tests; synthetic replies only, no PC/SC implementation."""
import io
import json
import sys
import types
import unittest
from unittest.mock import patch
import readiness_07297620 as p


def wrapped(p1,p2):
    return bytes([0x84,0xf2,p1,p2,10,0x4f,0])+bytes(9)


def sequence():
    init=bytes.fromhex('8050010008')+bytes(9)
    auth=bytes.fromhex('8482010010')+bytes(17)
    return [(p.ISD,b'\x6f\0'),(p.CPLC,bytes.fromhex(p.PROFILE['cplc'])),(p.ISD,b'\x6f\0'),
            (init,bytes(10)+b'\x01\x02'+bytes(16)),(auth,b''),(wrapped(0x40,2),b''),
            (wrapped(0x20,2),b''.join(p.BASELINE)),(p.ISD,b'\x6f\0'),(p.CPLC,bytes.fromhex(p.PROFILE['cplc']))]


class ReadinessPolicy(unittest.TestCase):
    def advance(self,policy,steps):
        for a,d in steps:
            policy.before(list(a));self.assertTrue(policy.after(a,list(d),*( (0x6a,0x88) if a[1]==0xf2 and not d else (0x90,0) )))

    def test_complete_once_and_no_extra_command(self):
        policy=p.Policy();self.advance(policy,sequence());self.assertTrue(policy.complete)
        with self.assertRaises(ValueError):policy.before(list(p.CPLC))

    def test_foreign_frames_at_every_stage_and_missing_reply_latch_stop(self):
        for offset in range(9):
            for wrong in ('84e400000d4f03010203000000000000000000','b07d000000','b07e0000010000','84e800000901000000000000000000'):
                policy=p.Policy();self.advance(policy,sequence()[:offset])
                with self.assertRaises(ValueError):policy.before(list(bytes.fromhex(wrong)))
                with self.assertRaises(ValueError):policy.before(list(sequence()[offset][0]))
            policy=p.Policy();self.advance(policy,sequence()[:offset]);policy.before(list(sequence()[offset][0]))
            with self.assertRaises(ValueError):policy.before(list(sequence()[offset][0]))

    def test_bad_status_at_every_stage_and_wrong_card_fail_stop(self):
        for offset in range(9):
            policy=p.Policy();self.advance(policy,sequence()[:offset]);a,d=sequence()[offset]
            policy.before(list(a));self.assertFalse(policy.after(a,list(d),0x6f,0))
            with self.assertRaises(ValueError):policy.before(list(p.ISD))
        policy=p.Policy();self.advance(policy,sequence()[:1]);policy.before(list(p.CPLC));self.assertFalse(policy.after(p.CPLC,list(bytes(45)),0x90,0))

    def test_full_baseline_and_split_pages(self):
        policy=p.Policy();self.advance(policy,sequence()[:6]);data=b''.join(reversed(p.BASELINE));first=wrapped(0x20,2);more=wrapped(0x20,3)
        policy.before(list(first));self.assertTrue(policy.after(first,list(data[:13]),0x63,0x10));policy.before(list(more));self.assertTrue(policy.after(more,list(data[13:]),0x90,0))
        self.advance(policy,sequence()[7:]);self.assertTrue(policy.complete)
        rows=[dict(x) for x in p.PROFILE['baselinePages']];rows[1]['data']=b''.join(p.BASELINE[:3]).hex()
        with self.assertRaises(ValueError):p.verify_pages(rows)
        policy=p.Policy();self.advance(policy,sequence()[:6]);policy.before(list(first));self.assertTrue(policy.after(first,[0xe3],0x63,0x10))
        for _ in range(2):policy.before(list(more));self.assertTrue(policy.after(more,[0xe3],0x63,0x10))
        policy.before(list(more));self.assertFalse(policy.after(more,[0xe3],0x63,0x10))

    def test_main_closes_and_attests_policy_completion_with_fake_pcsc(self):
        events=[];steps=sequence();lines=''.join(json.dumps({'apdu':list(a)})+'\n' for a,_ in steps)+'{"close":true}\n'
        class Connection:
            def connect(self,**kwargs):events.append(('connect',kwargs))
            def transmit(self,a):
                expected,data=steps[len([e for e in events if isinstance(e,bytes)])]
                assert bytes(a)==expected;events.append(bytes(a));return list(data),*((0x6a,0x88) if a[1]==0xf2 and not data else (0x90,0))
            def disconnect(self):events.append('closed')
        class Reader:
            def __str__(self):return p.PROFILE['reader']
            def createConnection(self):return Connection()
        modules={'smartcard.System':types.SimpleNamespace(readers=lambda:[Reader()]),'smartcard.scard':types.SimpleNamespace(SCARD_SHARE_EXCLUSIVE=1,SCARD_LEAVE_CARD=0)}
        output=io.StringIO()
        actual_flags=sys.flags
        class IsolatedFlags:
            isolated=True;no_site=True
            def __getattr__(self,name):return getattr(actual_flags,name)
        with patch.object(sys,'flags',IsolatedFlags()),patch.dict(sys.modules,modules),patch.object(p,'request',return_value='unused-fake-package'),patch.object(sys,'argv',['bridge','--request','synthetic','--sha256','0'*64,'--site-packages','synthetic']),patch.object(sys,'stdin',io.StringIO(lines)),patch.object(sys,'stdout',output):
            p.main()
        messages=[json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(messages[0],{'ready':True});self.assertEqual(messages[-1],{'closed':True,'complete':True});self.assertEqual(events[-1],'closed')

if __name__=='__main__':unittest.main()
