"""Fixed public memory read: synthetic policy tests only."""
import unittest
from unittest.mock import patch
import memory_07297620 as p

MEMORY=bytes.fromhex('ff21108102000182040001d484830400000ea6')
SEQUENCE=[(p.ISD,b'\x6f\0'),(p.CPLC,bytes.fromhex(p.PROFILE['cplc'])),(p.MEMORY,MEMORY),(p.ISD,b'\x6f\0'),(p.CPLC,bytes.fromhex(p.PROFILE['cplc']))]


class MemoryPolicy(unittest.TestCase):
    def advance(self,policy,seq):
        for a,d in seq:
            policy.before(list(a));self.assertTrue(policy.after(a,list(d),0x90,0))

    def test_exact_sequence_once_and_no_extra_command(self):
        policy=p.Policy();self.advance(policy,SEQUENCE);self.assertTrue(policy.complete)
        self.assertEqual(policy.memory['persistentBytes'],119940);self.assertEqual(policy.memory['volatileBytes'],3750)
        with self.assertRaises(ValueError):policy.before(list(p.ISD))

    def test_no_auth_write_or_private_applet_frame_at_any_stage(self):
        for offset in range(5):
            for wrong in ('8050010008000000000000000000','84820100100000000000000000000000000000000000','84f240020a4f00000000000000000000','b07d000000','80e4000000','80e6020000'):
                policy=p.Policy();self.advance(policy,SEQUENCE[:offset])
                with self.assertRaises(ValueError):policy.before(list(bytes.fromhex(wrong)))
                with self.assertRaises(ValueError):policy.before(list(SEQUENCE[offset][0]))

    def test_changed_card_malformed_counter_status_and_missing_reply_stop(self):
        for offset in range(5):
            policy=p.Policy();self.advance(policy,SEQUENCE[:offset]);a,d=SEQUENCE[offset];policy.before(list(a));self.assertFalse(policy.after(a,list(d),0x6f,0))
            with self.assertRaises(ValueError):policy.before(list(p.ISD))
            policy=p.Policy();self.advance(policy,SEQUENCE[:offset]);policy.before(list(a))
            with self.assertRaises(ValueError):policy.before(list(a))
        for index,data in [(1,bytes(45)),(2,MEMORY[1:]),(2,MEMORY[:7]+b'\x82\x03'+MEMORY[9:]),(4,bytes(45))]:
            policy=p.Policy();self.advance(policy,SEQUENCE[:index]);a,_=SEQUENCE[index];policy.before(list(a));self.assertFalse(policy.after(a,list(data),0x90,0))

    def test_unapproved_request_refuses_before_runtime_or_package_admission(self):
        class Args:
            request='unused';sha256='0'*64;site_packages='/never/import'
        value=dict(format='card-memory-request-v1',planId=p.PROFILE['planId'],approved=True,profileSha256='0'*64,python='unused',sitePackages='unused',files={},marker={},journal='unused',campaignSha256='0'*64)
        with patch.dict(p.PROFILE,{'approved':False}),patch.object(p,'private_json',return_value=value):
            with self.assertRaisesRegex(ValueError,'execution approval required'):p.request(Args())


if __name__=='__main__':unittest.main()
