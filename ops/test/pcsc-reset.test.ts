import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openResetReader} from '../src/pcsc-reset';

test('private bridge reports bounded readiness failures without a reader or native error text', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cashu-bridge-error-'));
  const executable = join(directory, 'fake-bridge');
  try {
    for (const [reported, expected] of [
      ['card-connect-failed', 'card-connect-failed'],
      ['private native detail', 'bridge-stopped'],
    ]) {
      writeFileSync(
        executable,
        "#!/bin/sh\nprintf '%s\\n' '" +
          JSON.stringify({error: reported}) +
          "'\n",
        {mode: 0o700},
      );
      await assert.rejects(
        () => openResetReader(executable, 'fake reader'),
        error =>
          error instanceof Error &&
          'code' in error &&
          error.code === expected &&
          !error.message.includes('private native detail'),
      );
    }
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('private pipe framing exchanges one reply and closes without retry or hardware', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cashu-bridge-pipe-'));
  const executable = join(directory, 'fake-bridge');
  try {
    writeFileSync(
      executable,
      "#!/bin/sh\nprintf '%s\\n' '{\"ready\":true}'\nIFS= read -r command\nprintf '%s\\n' '{\"reply\":[144,0]}'\nIFS= read -r command\n",
      {mode: 0o700},
    );
    const reader = await openResetReader(executable, 'fake reader');
    assert.deepEqual(await reader.tx([0, 0xa4, 4, 0, 0]), [0x90, 0]);
    await reader.close();
    await assert.rejects(() => reader.tx([0, 0xa4, 4, 0, 0]));
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
