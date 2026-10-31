"""Offline recovery-policy checks. This module imports no PC/SC library."""
import unittest
import compact_recovery_bridge as r
b=r.b

def wrapped(ins,p1,p2,body):return list(bytes([0x84,ins,p1,p2,len(body)+8])+body+bytes(9))
def send(p,a,data=b'',sw=(0x90,0)):
    a=p.before(list(a));p.after(a,list(data),*sw)
def selected():
    p=r.Policy();send(p,b.common.select(b.PRIVATE[0]),b'CPROT\x02')
    send(p,b.cmd(0x7d),bytes.fromhex('7fff0a0e0a0014001400400030000205'))
    send(p,b.cmd(0x7a),r.EXPECTED_KEY)
    return p
SCOPE=b'\0'+(1).to_bytes(8,'big')+(1).to_bytes(4,'big')+bytes(32)
DELETE=wrapped(0xe4,0,0,b'\x4f'+b.common.field(b.PRIVATE[0]))

class RecoveryPolicy(unittest.TestCase):
    def test_sign_load_install_setup_and_other_namespaces_are_excluded(self):
        p=selected()
        for a in b.fixture_commands(b.MAX):
            if a[1] in (0x75,0x7c):continue
            with self.assertRaises(ValueError):p.before(list(a))
        for a in [wrapped(0xe8,0,0,b'\1'),wrapped(0xe6,2,0,b.common.field(b.PACKAGE)+b.common.field(b.common.ISD)+b'\0\0\0'),wrapped(0xd8,1,0x81,bytes(67))]:
            with self.assertRaises(ValueError):p.before(a)
        for aid in b.common.PRODUCTION+b.OLD:
            with self.assertRaises(ValueError):p.before(list(b.common.select(aid)))
            with self.assertRaises(ValueError):p.before(wrapped(0xe4,0,0,b'\x4f'+b.common.field(aid)))
        with self.assertRaises(ValueError):p.before(DELETE)
    def test_unpublished_state_requires_matching_key_diagnostics_and_absent_scope(self):
        p=selected();send(p,b.cmd(0x76),r.UNPUBLISHED)
        with self.assertRaises(ValueError):p.before(DELETE)
        send(p,b.cmd(0x7c,b'\0'),b'',(0x69,0x85));p.before(DELETE)
        replay=list(DELETE);replay[-2]=1
        with self.assertRaises(ValueError):p.before(replay)
        with self.assertRaises(ValueError):p.before(list(b.cmd(0x77,SCOPE)))
    def test_retirement_requires_every_complete_page_and_exact_scope_then_free_status(self):
        p=selected();send(p,b.cmd(0x76),r.CONSUMED);send(p,b.cmd(0x7c,b'\0'),SCOPE)
        with self.assertRaises(ValueError):p.before(list(b.cmd(0x77,SCOPE)))
        for a in sorted(r.PAGES):send(p,a,bytes(a[8]))
        with self.assertRaises(ValueError):p.before(list(next(iter(r.PAGES))))
        wrong=SCOPE[:-1]+b'\1'
        with self.assertRaises(ValueError):p.before(list(b.cmd(0x77,wrong)))
        send(p,b.cmd(0x77,SCOPE),b'\1')
        with self.assertRaises(ValueError):p.before(DELETE)
        send(p,b.cmd(0x76),r.RETIRED);p.before(DELETE)
    def test_failed_page_stops_all_further_commands(self):
        p=selected();send(p,b.cmd(0x76),r.CONSUMED);send(p,b.cmd(0x7c,b'\0'),SCOPE)
        a=next(iter(r.PAGES));send(p,a,bytes(a[8]-1))
        for command in [b.cmd(0x77,SCOPE),b.cmd(0x76),b.common.select(b.common.ISD),bytes(DELETE)]:
            with self.assertRaises(ValueError):p.before(list(command))
    def test_bad_key_or_scope_status_latches_stop(self):
        p=r.Policy();send(p,b.common.select(b.PRIVATE[0]),b'CPROT\x02');send(p,b.cmd(0x7a),bytes(33))
        with self.assertRaises(ValueError):p.before(list(b.cmd(0x76)))
        p=selected();send(p,b.cmd(0x76),r.CONSUMED);send(p,b.cmd(0x7c,b'\0'),b'',(0x69,0x85))
        with self.assertRaises(ValueError):p.before(DELETE)
    def test_authentication_cannot_be_retried_before_cleanup_is_proved(self):
        p=r.Policy();a=list(bytes.fromhex('8050010008')+bytes(9));p.before(a)
        altered=list(a);altered[5]=1
        with self.assertRaises(ValueError):p.before(altered)
        p=r.Policy();a=wrapped(0x82,1,0,bytes(8));p.before(a)
        altered=list(a);altered[5]=1
        with self.assertRaises(ValueError):p.before(altered)

if __name__=='__main__':unittest.main()
