import {
  assertMatches,
  assertOk,
  assertUnsignedBigInt,
} from '@event-driven-io/emmett';
// import { Test, type Response } from 'supertest';
import { type ETag, getWeakETagValue } from '../etag';

export type TestResponse<RequestBody> = Omit<
  Omit<Response, 'body'>,
  'headers'
> & {
  body: Partial<RequestBody>;
  headers: Record<string, string>;
};

export const expectNextRevisionInResponseEtag = (response: Response) => {
  const eTagValue = response.headers.get('etag');
  assertOk(eTagValue);
  assertMatches(eTagValue, /W\/"\d+.*"/);

  const eTag = getWeakETagValue(eTagValue as ETag);

  return assertUnsignedBigInt(eTag);
};

// export const runTwice = (test: () => Test) => {
//   const expect = async (assert: {
//     first: (test: Test) => Test;
//     second: (test: Test) => Test;
//   }): Promise<Test> => {
//     const { first: firstExpect, second: secondExpect } = assert;

//     const result = await firstExpect(test());
//     await secondExpect(test());

//     return result;
//   };

//   return { expect };
// };

// export const statuses = (first: number, second: number) => {
//   return {
//     first: (test: Test) => test.expect(first),
//     second: (test: Test) => test.expect(second),
//   };
// };
