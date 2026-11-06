"""Synthetic identity reads; no PC/SC imports."""
import unittest
import check_reader_identity as p

CPLC = bytes.fromhex('9f7f2a4790d321470000000000304109336120554700000000000000000434a939333336310000000000000000')

class IdentityRead(unittest.TestCase):
    def run_case(self, fault=None):
        events=[];saved={}
        class Connection:
            def connect(self, **kwargs): events.append(('connect', kwargs))
            def transmit(self, a):
                events.append(bytes(a))
                if fault=='transmit': raise RuntimeError('private native text')
                if fault=='status': return [],0x6f,0
                return (list(CPLC) if len([e for e in events if isinstance(e,bytes)])==2 else [0x6f,0]),0x90,0
            def disconnect(self):
                events.append('closed')
                if fault=='close': raise RuntimeError('private native text')
        class Reader:
            def __str__(self): return p.READER
            def createConnection(self): return Connection()
        def save(name,value):
            if name in saved: raise AssertionError('receipt overwritten')
            saved[name]=value
            if fault=='storage' and name=='intent-1': raise RuntimeError('disk')
        def readers():
            self.assertIn('consumed',saved)
            return [Reader()]
        result=p.inspect(readers,1,0,save)
        return result,events,saved

    def test_fixed_two_commands_and_confirmed_close(self):
        r,e,s=self.run_case()
        self.assertEqual(r['status'],'read-complete');self.assertTrue(r['readerClosed'])
        self.assertEqual([v for v in e if isinstance(v,bytes)],list(p.FRAMES))
        self.assertEqual(r['cplc'],CPLC.hex());self.assertEqual(e[-1],'closed')

    def test_status_transport_storage_and_close_faults_never_retry(self):
        for fault in ('status','transmit','storage','close'):
            r,e,s=self.run_case(fault)
            self.assertEqual(r['status'],'stopped')
            self.assertEqual(len([v for v in e if isinstance(v,bytes)]),0 if fault=='storage' else 2 if fault=='close' else 1)
            self.assertEqual(e[-1],'closed');self.assertNotIn('private native text',str(r))

if __name__=='__main__':unittest.main()
