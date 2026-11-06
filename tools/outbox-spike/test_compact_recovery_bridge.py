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
    def test_an_unset_up_card_is_read_but_never_deleted(self):
        # The installer's own diagnostics, from a card that never reached SETUP.
        # The read is allowed -- recovery has to know where the card stands --
        # but it latches the stop, so no frame after it can delete anything.
        p=r.Policy();send(p,b.common.select(b.PRIVATE[0]),b'CPROT\x02')
        send(p,b.cmd(0x7d),bytes.fromhex('7fff0a0e0a0014001400000000000005'))
        for command in (b.cmd(0x7a),b.cmd(0x76),b.cmd(0x7c,b'\0'),DELETE):
            with self.assertRaises(ValueError):p.before(list(command))
    def test_authentication_cannot_be_retried_before_cleanup_is_proved(self):
        p=r.Policy();a=list(bytes.fromhex('8050010008')+bytes(9));p.before(a)
        altered=list(a);altered[5]=1
        with self.assertRaises(ValueError):p.before(altered)
        p=r.Policy();a=wrapped(0x82,1,0,bytes(8));p.before(a)
        altered=list(a);altered[5]=1
        with self.assertRaises(ValueError):p.before(altered)

class AnsweredCplc(unittest.TestCase):
    """A CPLC reply carrying one byte ahead of the 9F7F TLV, and the shape the
    bridge's loop needs back: a list, because the reply is emitted by
    concatenating onto what pyscard returned."""
    # The card's own CPLC, as captured through this bridge: 45 bytes, TLV only.
    TLV=bytes.fromhex('9f7f2a4790d321470000000000304109336120554700000000000000000434a939333336310000000000000000')
    FRAME=bytes.fromhex('80ca9f7f00')

    def test_the_leading_byte_is_dropped_and_a_list_comes_back(self):
        self.assertEqual(len(self.TLV),45)
        data,sw1,sw2=r.trim_cplc(self.FRAME,(list(b'\x00'+self.TLV),0x90,0))
        self.assertEqual((data,sw1,sw2),(list(self.TLV),0x90,0))
        self.assertIsInstance(data,list)

    def test_nothing_else_is_reshaped(self):
        for reply in (
            (list(self.TLV),0x90,0),                         # already a TLV
            (list(b'\x00'+self.TLV[:44]),0x90,0),           # one byte short
            (list(b'\x00\x00'+self.TLV),0x90,0),           # two ahead
            (list(b'\x00'+b'\x9f\x7f\x2b'+bytes(42)),0x90,0), # wrong tag
            (list(b'\x00'+self.TLV),0x6a,0x86),             # not a success
        ):
            self.assertEqual(r.trim_cplc(self.FRAME,reply)[0],reply[0],reply[0][:4])

    def test_another_command_is_left_alone(self):
        other=bytes.fromhex('b07a000000')
        self.assertEqual(r.trim_cplc(other,(list(b'\x00'+self.TLV),0x90,0))[0],list(b'\x00'+self.TLV))

if __name__=='__main__':unittest.main()
