const textEncoder = new TextEncoder();

export const hashText = async (text: string): Promise<bigint> => {
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    textEncoder.encode(text),
  );
  // Create an array with a single element that is a 64-bit signed integer
  // We take the first 8 bytes (so 64 bits) of the SHA-256 hash
  const view = new BigInt64Array(hashBuffer, 0, 1);
  return view[0]!;
};
