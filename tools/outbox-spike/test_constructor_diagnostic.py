"""Independent closed diagnostic policy; synthetic APDUs, no PC/SC imports."""
import hashlib
import unittest
from unittest.mock import patch
import constructor_diagnostic_07297620 as p

LOAD=bytes(p.PROFILE['bytes'])
STAGES=[dict(id=i+1,file='CashuApplet.java' if i<48 else 'SchnorrHW.java',statement='schnorrHW.init();' if i==47 else 'operation%d();'%(i+1)) for i in range(64)]
for s in STAGES:s['statementSha256']=hashlib.sha256(s['statement'].encode()).hexdigest()


def wrapped(a):return bytes([0x84])+a[1:4]+bytes([a[4]+8])+a[5:-1]+bytes(8)+b'\0'


def sequence(fault=False):
    policy=p.Policy(LOAD,STAGES);steps=[]
    while not policy.complete:
        name,mode,command,check=policy.program[policy.index];a=policy.expected()
        if mode in ('registry','secure'):a=wrapped(a)
        if mode=='registry':data=bytes.fromhex(next(v['data'] for v in p.PROFILE['initialPages'] if v['kind']==command)+(next(v['data'] for v in p.PROFILE['addedPages'] if v['kind']==command) if check else ''))
        elif check=='cplc':data=bytes.fromhex(p.PROFILE['cplc'])
        elif check=='init':data=bytes(10)+bytes.fromhex('0102')+bytes(16)
        elif check=='auth':data=b''
        elif check=='ack':data=b'\0'
        elif check=='select':data=p.SELECT_DATA
        elif check=='diagnostic':data=bytes.fromhex('010331010003' if fault else '010430000000')
        else:data=b'\x6f\0'
        policy.before(list(a));assert policy.after(a,list(data),0x90,0);steps.append((a,data))
    return steps


class DiagnosticPolicy(unittest.TestCase):
    def advance(self,policy,steps):
        for a,data in steps:policy.before(list(a));self.assertTrue(policy.after(a,list(data),0x90,0))

    def test_one_program_both_constructor_outcomes_and_no_extra_command(self):
        for fault in (False,True):
            policy=p.Policy(LOAD,STAGES);self.advance(policy,sequence(fault));self.assertTrue(policy.complete)
            self.assertEqual(policy.total,p.PROFILE['blocks']+16);self.assertEqual(policy.diagnostic['outcome'],'caught-constructor-fault' if fault else 'constructor-complete')
            with self.assertRaises(ValueError):policy.before(list(p.ISD))

    def test_forbidden_frames_and_missing_replies_at_every_stage_latch_stop(self):
        steps=sequence()
        for index in range(len(steps)):
            for wrong in ('84e400000b4f01000000000000000000','80d8000000','b07a000000','b07e000000','8050000008000000000000000000'):
                policy=p.Policy(LOAD,STAGES);self.advance(policy,steps[:index])
                with self.assertRaises(ValueError):policy.before(list(bytes.fromhex(wrong)))
                with self.assertRaises(ValueError):policy.before(list(steps[index][0]))
            policy=p.Policy(LOAD,STAGES);self.advance(policy,steps[:index]);policy.before(list(steps[index][0]))
            with self.assertRaises(ValueError):policy.before(list(steps[index][0]))

    def test_refused_reply_bad_load_body_and_changed_retained_registry_stop(self):
        steps=sequence()
        for index in range(len(steps)):
            policy=p.Policy(LOAD,STAGES);self.advance(policy,steps[:index]);a,data=steps[index];policy.before(list(a));self.assertFalse(policy.after(a,list(data),0x6f,0))
            with self.assertRaises(ValueError):policy.before(list(p.ISD))
        policy=p.Policy(LOAD,STAGES);self.advance(policy,steps[:8]);a=bytearray(steps[8][0]);a[5]^=1
        with self.assertRaises(ValueError):policy.before(list(a))
        policy=p.Policy(LOAD,STAGES);self.advance(policy,steps[:5]);a,data=steps[5];policy.before(list(a));self.assertFalse(policy.after(a,list(data+data),0x90,0))

    def test_unapproved_request_stops_before_artifact_or_runtime_admission(self):
        class Args:request='unused';sha256='0'*64;site_packages='/never/import'
        v=dict(format='card-constructor-diagnostic-request-v1',planId=p.PROFILE['planId'],approved=True,profileSha256='0'*64,python='unused',sitePackages='unused',files={},marker={},journal='unused',campaignSha256='0'*64)
        with patch.dict(p.PROFILE,{'approved':False}),patch.object(p,'private_json',return_value=v):
            with self.assertRaisesRegex(ValueError,'execution approval required'):p.request(Args())


if __name__=='__main__':unittest.main()
