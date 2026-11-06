"""Read-only inspection policy: synthetic replies, never a reader."""
import json
import sys
import unittest
from unittest.mock import patch
import inspect_07297620 as p


def wrapped(p1,p2):
    return bytes([0x84,0xf2,p1,p2,10,0x4f,0])+bytes(9)


def sequence(main=False):
    return [(p.ISD,b'\x6f\0'),(p.CPLC,bytes.fromhex(p.PROFILE['cplc'])),(p.ISD,b'\x6f\0'),
            (bytes.fromhex('8050010008')+bytes(9),bytes(10)+b'\x01\x02'+bytes(16)),
            (bytes.fromhex('8482010010')+bytes(17),b''),
            (wrapped(0x40,2),p.PRIVATE['applications'][0]+(p.PRIVATE['applications'][1] if main else b'')),
            (wrapped(0x20,2),b''.join(p.BASELINE+p.PRIVATE['load-files'])),
            (p.ISD,b'\x6f\0'),(p.CPLC,bytes.fromhex(p.PROFILE['cplc']))]


class InspectionPolicy(unittest.TestCase):
    def advance(self,policy,steps):
        for a,d in steps:
            policy.before(list(a));self.assertTrue(policy.after(a,list(d),0x90,0))

    def test_complete_both_memberships_and_never_any_write(self):
        for main in (False,True):
            policy=p.Policy();self.advance(policy,sequence(main));self.assertTrue(policy.complete)
            with self.assertRaises(ValueError):policy.before(list(p.ISD))
        for offset in range(9):
            for wrong in ('84e400000d4f03010203000000000000000000','b07d000000','b07a000000','84e800000901000000000000000000','84e60200080000000000000000','80d8000000'):
                policy=p.Policy();self.advance(policy,sequence()[:offset])
                with self.assertRaises(ValueError):policy.before(list(bytes.fromhex(wrong)))
                with self.assertRaises(ValueError):policy.before(list(sequence()[offset][0]))

    def test_status_failure_wrong_card_and_missing_reply_latch_stop(self):
        for offset in range(9):
            policy=p.Policy();self.advance(policy,sequence()[:offset]);a,d=sequence()[offset]
            policy.before(list(a));self.assertFalse(policy.after(a,list(d),0x6f,0))
            with self.assertRaises(ValueError):policy.before(list(p.ISD))
            policy=p.Policy();self.advance(policy,sequence()[:offset]);policy.before(list(a))
            with self.assertRaises(ValueError):policy.before(list(a))
        policy=p.Policy();self.advance(policy,sequence()[:1]);policy.before(list(p.CPLC));self.assertFalse(policy.after(p.CPLC,list(bytes(45)),0x90,0))

    def test_exact_registry_and_continuation_bound(self):
        for main in (False,True):
            policy=p.Policy();self.advance(policy,sequence(main)[:6]);data=sequence(main)[6][1]
            a=wrapped(0x20,2);more=wrapped(0x20,3)
            policy.before(list(a));self.assertTrue(policy.after(a,list(data[:13]),0x63,0x10))
            policy.before(list(more));self.assertTrue(policy.after(more,list(data[13:]),0x90,0))
            self.advance(policy,sequence()[7:]);self.assertTrue(policy.complete)
        for raw in (b''.join(p.BASELINE),b''.join(p.BASELINE[:3]+p.PRIVATE['load-files']),b''.join(p.BASELINE+p.PRIVATE['load-files']*2)):
            policy=p.Policy();self.advance(policy,sequence()[:6]);a=wrapped(0x20,2);policy.before(list(a));self.assertFalse(policy.after(a,list(raw),0x90,0))
        policy=p.Policy();self.advance(policy,sequence()[:6]);a=wrapped(0x20,2);more=wrapped(0x20,3)
        for i in range(4):
            cmd=a if i==0 else more;policy.before(list(cmd));self.assertEqual(policy.after(cmd,[0xe3],0x63,0x10),i<3)

    def test_unapproved_request_refuses_before_package_import(self):
        class Args:
            request='synthetic';sha256='0'*64;site_packages='/never/import'
        v={'format':'card-inspection-request-v1','planId':p.PROFILE['planId'],'approved':True,'profileSha256':'0'*64,'python':sys.executable,'sitePackages':Args.site_packages,'files':{},'marker':{},'journal':'unused','campaignSha256':'0'*64}
        with patch.dict(p.PROFILE,{'approved':False}),patch.object(p,'private_json',return_value=v):
            with self.assertRaisesRegex(ValueError,'execution approval required'):p.request(Args())


if __name__=='__main__':unittest.main()
