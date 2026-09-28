import { describe, expect, it } from 'vitest';
import {
  apiRootFromRoutePattern,
  joinRoutePath,
  normalizeMountPath,
  readJSONBody,
  toColonRoutePath,
} from './portableApi';

const bodyOf = (text: string) => new Response(text).body;

void describe('portable routes', () => {
  void it('normalises mount paths', () => {
    expect(normalizeMountPath('emmett/v1/')).toBe('/emmett/v1');
    expect(normalizeMountPath('/')).toBe('');
    expect(normalizeMountPath(undefined)).toBe('');
  });

  void it('joins mount path and route path', () => {
    expect(joinRoutePath('/v1', '/streams')).toBe('/v1/streams');
    expect(joinRoutePath('/v1', '')).toBe('/v1');
    expect(joinRoutePath('', '')).toBe('/');
  });

  void it('converts placeholders to the colon syntax', () => {
    expect(toColonRoutePath('/streams/{streamName}/messages')).toBe(
      '/streams/:streamName/messages',
    );
  });

  void it('derives the API root from the matched framework pattern', () => {
    expect(
      apiRootFromRoutePattern('/api/emmett/v1/streams/:streamName', {
        path: '/streams/{streamName}',
      }),
    ).toBe('/api/emmett/v1');
    expect(apiRootFromRoutePattern('/emmett/v1', { path: '' })).toBe(
      '/emmett/v1',
    );
  });
});

void describe('readJSONBody', () => {
  void it('parses a JSON body', async () => {
    const result = await readJSONBody(
      { body: bodyOf('{"a":1}'), headers: new Headers() },
      { maxBytes: 100 },
    );

    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  void it('returns the body already parsed by the host', async () => {
    const result = await readJSONBody(
      { body: null, parsedBody: { a: 1 }, headers: new Headers() },
      { maxBytes: 100 },
    );

    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  void it('rejects bodies larger than the limit', async () => {
    const result = await readJSONBody(
      { body: bodyOf('{"a":"0123456789"}'), headers: new Headers() },
      { maxBytes: 5 },
    );

    expect(result).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });

  void it('rejects malformed and empty bodies', async () => {
    expect(
      await readJSONBody(
        { body: bodyOf('{'), headers: new Headers() },
        { maxBytes: 100 },
      ),
    ).toEqual({ ok: false, reason: 'INVALID_JSON' });
    expect(
      await readJSONBody(
        { body: null, headers: new Headers() },
        { maxBytes: 100 },
      ),
    ).toEqual({ ok: false, reason: 'EMPTY' });
  });
});
