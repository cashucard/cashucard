// Public mempool.space responses for Bitcoin block 900000.
export const tipUrl = 'https://mempool.space/api/blocks/tip/height';
export const blockIdUrl = 'https://mempool.space/api/block-height/900000';
export const blockId =
  '000000000000000000010538edbfd2d5b809a33dd83f284aeea41c6d0d96968a';
export const headerUrl = `https://mempool.space/api/block/${blockId}/header`;
export const headerHex =
  '00a0ab20247d4d9f582f9750344cdf62c46d81d046be9603409601000000000000000000' +
  '70f96945530651135839d8adc3f40e595118ec74c7ad81a3d17bb022e554fb0c937f4268743702177ad05f92';

export function recordedTip(): Map<string, Buffer | Error> {
  return new Map([
    [tipUrl, Buffer.from('900000')],
    [blockIdUrl, Buffer.from(blockId)],
    [headerUrl, Buffer.from(headerHex)],
  ]);
}

export async function recordedFetch(url: string): Promise<Buffer> {
  const response = recordedTip().get(url);
  if (!response || response instanceof Error)
    throw new Error('unexpected fixture URL');
  return response;
}
