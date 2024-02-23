import type { Response } from 'light-my-request';
import assert from 'node:assert/strict';
import type { Test } from 'supertest';

export type TestResponse<RequestBody> = Omit<
  Omit<Response, 'body'>,
  'headers'
> & {
  body: Partial<RequestBody>;
  headers: Record<string, string>;
};

export const expectNextRevisionInResponseEtag = <RequestBody>(
  response: TestResponse<RequestBody>,
) => {
  const eTagValue = response.headers['etag'];
  assert.ok(eTagValue);
  assert.match(eTagValue, /W\/"\d+.*"/);
};

export const runTwice = (test: () => Promise<Response>) => {
  const expect = async (assert: {
    first: (test: Response) => Promise<Response>;
    second: (test: Response) => Promise<Response>;
  }): Promise<Response> => {
    const { first: firstExpect, second: secondExpect } = assert;

    const result = await firstExpect(await test());
    await secondExpect(await test());

    return result;
  };

  return { expect };
};

export const statuses = (first: number, second: number) => {
  return {
    first: (test: Test) => test.expect(first),
    second: (test: Test) => test.expect(second),
  };
};
