"""Offline policy regression cases. Never import a PC/SC implementation."""
import unittest
import unset_up_policy as p

def wrapped(ins,p1,p2,body):
    return bytes([0x84,ins,p1,p2,len(body)+8])+body+bytes(9)

def sequence():
    result=[]
    for kind, phase in p.STAGES:
        if kind=='isd':a,d=p.ISD,b'\x6f\0'
        elif kind=='cplc':a,d=p.CPLC,bytes.fromhex(p.PROFILE['cplc'])
        elif kind=='init':a,d=bytes.fromhex('8050010008')+bytes(9),bytes(10)+b'\1\2'+bytes(16)
        elif kind=='auth':a,d=bytes.fromhex('8482010010')+bytes(17),b''
        elif kind=='select':a,d=p.SELECT,b'CPROT\2'
        elif kind=='diag':a,d=p.DIAG,bytes.fromhex('7fff0a0e0a0014001400000000000005')
        elif kind=='key':a,d=p.KEY,bytes.fromhex(p.PROFILE['key'])
        elif kind=='delete':
            aid=bytes.fromhex(phase);a,d=wrapped(0xe4,0,0,bytes([0x4f,len(aid)])+aid),b'\0'
        else:
            a=wrapped(0xf2,0x40 if kind=='applications' else 0x20,2,b'\x4f\0')
            d=b''.join(([] if kind=='applications' else p.BASELINE) if phase==2 else p.EXPECTED[kind])
        result.append((a,d,(0x90,0) if d or kind not in ('applications','load-files') else (0x6a,0x88)))
    return result

class ClosedCleanup(unittest.TestCase):
    def advance(self,policy,steps):
        for a,d,sw in steps:
            policy.before(list(a));self.assertTrue(policy.after(a,list(d),*sw))

    def test_full_order_and_no_more_commands(self):
        policy=p.UnsetUpPolicy();self.advance(policy,sequence());self.assertTrue(policy.complete)
        with self.assertRaises(ValueError):policy.before(list(p.CPLC))

    def test_every_out_of_order_or_foreign_frame_latches_stop(self):
        for offset in range(len(p.STAGES)):
            for wrong in (bytes.fromhex('b076000000'),bytes.fromhex('b07c0000010000'),bytes.fromhex('b074000000'),bytes.fromhex('b07e0000010000'),wrapped(0xe4,0,0,b'\x4f\x05\x01\x02\x03\x04\x05')):
                policy=p.UnsetUpPolicy();self.advance(policy,sequence()[:offset])
                with self.assertRaises(ValueError):policy.before(list(wrong))
                with self.assertRaises(ValueError):policy.before(list(sequence()[offset][0]))

    def test_each_bad_status_or_lost_reply_blocks_every_next_frame(self):
        for offset in range(len(p.STAGES)):
            policy=p.UnsetUpPolicy();self.advance(policy,sequence()[:offset]);a,d,sw=sequence()[offset]
            policy.before(list(a));self.assertFalse(policy.after(a,list(d),0x6f,0))
            with self.assertRaises(ValueError):policy.before(list(p.ISD))
            policy=p.UnsetUpPolicy();self.advance(policy,sequence()[:offset]);policy.before(list(a))
            with self.assertRaises(ValueError):policy.before(list(a))

    def test_unset_up_floor_key_and_chip_are_strict(self):
        changes={'diag':[bytes.fromhex(v) for v in ('7fff0a0e0a0014001400000000000105','7fff0a0e0a0014001400400030000205','7fff0a0e0a00007f007f000000000005')], 'key':[bytes(33)],'cplc':[bytes(45)]}
        for kind,values in changes.items():
            index=next(i for i,(name,_) in enumerate(p.STAGES) if name==kind)
            for data in values:
                policy=p.UnsetUpPolicy();self.advance(policy,sequence()[:index]);a,_,sw=sequence()[index]
                policy.before(list(a));self.assertFalse(policy.after(a,list(data),*sw))

    def test_package_must_exist_before_deletion_and_be_absent_afterward(self):
        for index,(kind,phase) in enumerate(p.STAGES):
            if kind!='load-files':continue
            policy=p.UnsetUpPolicy();self.advance(policy,sequence()[:index]);a,_,sw=sequence()[index]
            wrong=b''.join(p.EXPECTED[kind] if phase==2 else p.BASELINE)
            policy.before(list(a));self.assertFalse(policy.after(a,list(wrong),*sw))

    def test_partial_registry_frames_and_four_page_bound(self):
        index=next(i for i,s in enumerate(p.STAGES) if s==('load-files',0))
        policy=p.UnsetUpPolicy();self.advance(policy,sequence()[:index]);data=b''.join(reversed(p.EXPECTED['load-files']))
        first=wrapped(0xf2,0x20,2,b'\x4f\0');more=wrapped(0xf2,0x20,3,b'\x4f\0')
        policy.before(list(first));self.assertTrue(policy.after(first,list(data[:13]),0x63,0x10))
        policy.before(list(more));self.assertTrue(policy.after(more,list(data[13:]),0x90,0))
        for d in (b'',b'\xe3'):
            policy=p.UnsetUpPolicy();self.advance(policy,sequence()[:index]);policy.before(list(first))
            good=policy.after(first,list(d),0x63,0x10)
            if good:
                for _ in range(3):policy.before(list(more));good=policy.after(more,list(d),0x63,0x10)
            self.assertFalse(good)

if __name__=='__main__':unittest.main()
