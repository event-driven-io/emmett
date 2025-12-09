import {
  assertEqual,
  assertMatches,
  assertOk,
  assertUnsignedBigInt,
} from '@event-driven-io/emmett';
import { type ETag, getWeakETagValue } from '../etag';

export const expectNextRevisionInResponseEtag = (response: Response) => {
  const eTagValue = response.headers.get('etag');
  assertOk(eTagValue);
  assertMatches(eTagValue, /W\/"\d+.*"/);

  const eTag = getWeakETagValue(eTagValue as ETag);

  return assertUnsignedBigInt(eTag);
};

export const runTwice = (test: () => Response | Promise<Response>) => {
  const expect = async (assert: {
    first: (response: Response) => void | Promise<void>;
    second: (response: Response) => void | Promise<void>;
  }): Promise<Response> => {
    const { first: firstExpect, second: secondExpect } = assert;

    const firstResponse = await test();
    await firstExpect(firstResponse.clone());

    const secondResponse = await test();
    await secondExpect(secondResponse);

    return firstResponse;
  };

  return { expect };
};

export const statuses = (first: number, second: number) => {
  return {
    first: (response: Response) => {
      assertEqual(response.status, first);
    },
    second: (response: Response) => {
      assertEqual(response.status, second);
    },
  };
};
