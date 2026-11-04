import { describe, it } from 'vitest';
import { defaultErrorToProblemDetailsMapping, ProblemDocument } from '.';
import { EmmettError } from '../errors';
import { assertDeepEqual, assertEqual, assertFalse } from '../testing';

void describe('ProblemDocument', () => {
  void it('uses about:blank as type when type is not given', () => {
    const problem = new ProblemDocument({ status: 404 });

    assertEqual(problem.type, 'about:blank');
  });

  void it('uses the given type', () => {
    const problem = new ProblemDocument({
      status: 402,
      type: 'https://example.com/probs/card-declined',
    });

    assertEqual(problem.type, 'https://example.com/probs/card-declined');
  });

  void it('uses the given title', () => {
    const problem = new ProblemDocument({
      status: 402,
      title: 'Card Declined',
    });

    assertEqual(problem.title, 'Card Declined');
  });

  void it('uses the given title even when type is about:blank', () => {
    const problem = new ProblemDocument({
      status: 409,
      type: 'about:blank',
      title: 'Room Already Booked',
    });

    assertEqual(problem.title, 'Room Already Booked');
  });

  void it('uses the HTTP reason phrase of the status as title when title is not given', () => {
    assertEqual(new ProblemDocument({ status: 400 }).title, 'Bad Request');
    assertEqual(new ProblemDocument({ status: 402 }).title, 'Payment Required');
    assertEqual(new ProblemDocument({ status: 404 }).title, 'Not Found');
    assertEqual(new ProblemDocument({ status: 409 }).title, 'Conflict');
    assertEqual(
      new ProblemDocument({ status: 412 }).title,
      'Precondition Failed',
    );
    assertEqual(
      new ProblemDocument({ status: 500 }).title,
      'Internal Server Error',
    );
  });

  void it('has no title when title is not given and the status has no reason phrase', () => {
    const problem = new ProblemDocument({ status: 499 });

    assertFalse('title' in problem);
  });

  void it('has no detail and instance when they are not given', () => {
    const problem = new ProblemDocument({ status: 404 });

    assertFalse('detail' in problem);
    assertFalse('instance' in problem);
  });

  void it('uses the given detail and instance', () => {
    const problem = new ProblemDocument({
      status: 404,
      detail: 'Shopping cart not found',
      instance: '/carts/123',
    });

    assertEqual(problem.detail, 'Shopping cart not found');
    assertEqual(problem.instance, '/carts/123');
  });

  void it('copies extension members as top-level properties', () => {
    const problem = new ProblemDocument(
      { status: 402 },
      { balance: 30, accounts: ['/account/12345'] },
    );

    assertEqual(problem.balance, 30);
    assertDeepEqual(problem.accounts, ['/account/12345']);
  });

  void it('keeps standard members when extensions have members with the same name', () => {
    const problem = new ProblemDocument(
      { status: 409, title: 'Conflict', detail: 'Room is already booked' },
      {
        type: 'https://example.com/other',
        title: 'Other',
        status: 500,
        detail: 'Other detail',
        instance: '/other',
      },
    );

    assertDeepEqual(
      { ...problem },
      {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'Room is already booked',
      },
    );
  });

  void it('serializes to a flat JSON object with standard and extension members', () => {
    const problem = new ProblemDocument(
      {
        status: 402,
        type: 'https://example.com/probs/out-of-credit',
        title: 'You do not have enough credit.',
        detail: 'Your current balance is 30, but that costs 50.',
        instance: '/account/12345/msgs/abc',
      },
      { balance: 30 },
    );

    assertDeepEqual(JSON.parse(JSON.stringify(problem)), {
      type: 'https://example.com/probs/out-of-credit',
      title: 'You do not have enough credit.',
      status: 402,
      detail: 'Your current balance is 30, but that costs 50.',
      instance: '/account/12345/msgs/abc',
      balance: 30,
    });
  });
});

void describe('defaultErrorToProblemDetailsMapping', () => {
  void it('maps EmmettError status and message', () => {
    const problem = defaultErrorToProblemDetailsMapping(
      new EmmettError({ status: 404, message: 'Shopping cart not found' }),
    );

    assertDeepEqual(
      { ...problem },
      {
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'Shopping cart not found',
      },
    );
  });

  void it('does not expose code, details and cause of the error', () => {
    const problem = defaultErrorToProblemDetailsMapping(
      new EmmettError({
        status: 409,
        message: 'Room is already booked',
        code: 'X',
        details: { a: 1 },
        cause: new Error('c'),
      }),
    );

    assertDeepEqual(
      { ...problem },
      {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'Room is already booked',
      },
    );
  });

  void it('uses statusCode when error has no status', () => {
    const error = Object.assign(new Error('Body is invalid'), {
      statusCode: 400,
    });

    const problem = defaultErrorToProblemDetailsMapping(error);

    assertEqual(problem.status, 400);
    assertEqual(problem.detail, 'Body is invalid');
  });

  void it('uses statusCode of a plain object', () => {
    const problem = defaultErrorToProblemDetailsMapping({ statusCode: 400 });

    assertEqual(problem.status, 400);
  });

  void it('uses the deprecated errorCode when error has no status and statusCode', () => {
    const problem = defaultErrorToProblemDetailsMapping({ errorCode: 412 });

    assertEqual(problem.status, 412);
  });

  void it('prefers status over statusCode', () => {
    const problem = defaultErrorToProblemDetailsMapping({
      status: 409,
      statusCode: 400,
    });

    assertEqual(problem.status, 409);
  });

  void it('uses 500 when status is out of the HTTP status range', () => {
    const problem = defaultErrorToProblemDetailsMapping(
      new EmmettError({ status: 600, message: 'Unknown' }),
    );

    assertEqual(problem.status, 500);
    assertEqual(problem.detail, 'Unknown');
  });

  void it('uses 500 Internal Server Error for a value that is not an error', () => {
    const problem = defaultErrorToProblemDetailsMapping(42);

    assertDeepEqual(
      { ...problem },
      {
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
        detail: 'Internal Server Error',
      },
    );
  });

  void it('uses a string error as detail', () => {
    const problem = defaultErrorToProblemDetailsMapping('Something failed');

    assertEqual(problem.status, 500);
    assertEqual(problem.detail, 'Something failed');
  });
});
