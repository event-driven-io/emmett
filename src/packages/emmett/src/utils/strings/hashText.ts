const textEncoder = new TextEncoder();

export const hashText = async (text: string): Promise<bigint> => {
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    textEncoder.encode(text),
  );
  const bytes = new Uint8Array(hashBuffer, 0, 8);
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
};
