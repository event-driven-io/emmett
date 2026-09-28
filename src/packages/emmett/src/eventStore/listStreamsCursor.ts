/**
 * Encodes the last listed stream name as an opaque, URL-safe cursor
 * for stores listing streams ordered by name.
 */
export const encodeStreamNameCursor = (streamName: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(streamName)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

/** Returns `undefined` for a malformed cursor. */
export const decodeStreamNameCursor = (cursor: string): string | undefined => {
  try {
    const binary = atob(cursor.replaceAll('-', '+').replaceAll('_', '/'));

    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    );
  } catch {
    return undefined;
  }
};
