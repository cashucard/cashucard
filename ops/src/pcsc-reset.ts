/** Private pipe to the allowlisted Python bridge. Never prints APDUs or errors from the child. */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import type {Transceiver} from '../../tools/cardkit';

export async function openResetReader(python: string, reader: string) {
  const child = spawn(
    python,
    [
      '-u',
      resolve(__dirname, '../../tools/cardctl/reset_bridge.py'),
      '--reader',
      reader,
    ],
    {stdio: ['pipe', 'pipe', 'ignore']},
  );
  const lines = createInterface({input: child.stdout});
  const iterator = lines[Symbol.asyncIterator]();
  child.on('error', () => lines.close());
  child.stdin.on('error', () => lines.close());
  let busy = false,
    closed = false;
  const next = async (): Promise<Record<string, unknown>> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const line = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            child.kill();
            reject(new Error('reader response unavailable'));
          }, 10000);
        }),
      ]);
      if (line.done || line.value.length > 4096)
        throw new Error('reader stopped');
      const message = JSON.parse(line.value) as Record<string, unknown>;
      if (!message || message.error) throw new Error('reader stopped');
      return message;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    if (child.exitCode !== null) {
      lines.close();
      return;
    }
    await new Promise<void>(resolveClose => {
      const timer = setTimeout(() => {
        child.kill();
        resolveClose();
      }, 1000);
      child.once('close', () => {
        clearTimeout(timer);
        resolveClose();
      });
      child.stdin.end('{"close":true}\n');
    });
    lines.close();
  };
  try {
    if ((await next()).ready !== true) throw new Error('reader unavailable');
  } catch {
    await close();
    throw new Error('reader unavailable; no retry');
  }
  const tx: Transceiver = async apdu => {
    if (closed || busy) throw new Error('reader unavailable');
    busy = true;
    try {
      child.stdin.write(JSON.stringify({apdu}) + '\n');
      const reply = (await next()).reply;
      if (
        !Array.isArray(reply) ||
        reply.length < 2 ||
        reply.some(v => !Number.isInteger(v) || v < 0 || v > 255)
      )
        throw new Error('invalid reader reply');
      return reply as number[];
    } catch {
      await close();
      throw new Error('reader stopped; no retry');
    } finally {
      busy = false;
    }
  };
  return {tx, close};
}
