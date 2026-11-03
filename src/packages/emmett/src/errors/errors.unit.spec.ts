import { describe, expectTypeOf, it } from 'vitest';
import {
  ConcurrencyError,
  ConcurrencyInMemoryDatabaseError,
  EmmettError,
  EmmettErrorTypeId,
  IllegalStateError,
  NotFoundError,
  ValidationError,
} from '.';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertTrue,
  assertUndefined,
} from '../testing';
import { emmettTypeId, hasTypeId } from '../typing';

void describe('EmmettError', () => {
  void it('carries status, message, code and details from options', () => {
    const error = new EmmettError({
      status: 409,
      message: 'Room is already booked',
      code: 'ROOM_ALREADY_BOOKED',
      details: { propertyId: 'property-1', eventId: 'event-1' },
    });

    assertEqual(error.status, 409);
    assertEqual(error.message, 'Room is already booked');
    assertEqual(error.code, 'ROOM_ALREADY_BOOKED');
    assertDeepEqual(error.details, {
      propertyId: 'property-1',
      eventId: 'event-1',
    });
  });

  void it('uses a default message with the status when message is not provided', () => {
    const error = new EmmettError({ status: 409 });

    assertEqual(
      error.message,
      `Error with status code '409' ocurred during Emmett processing`,
    );
    assertUndefined(error.code);
    assertUndefined(error.details);
  });

  void it('exposes cause as the native error cause', () => {
    const cause = new Error('Connection lost');

    const error = new EmmettError({ status: 503, cause });

    assertEqual(error.cause, cause);
    assertTrue(Object.prototype.hasOwnProperty.call(error, 'cause'));
  });

  void it('returns status from the deprecated errorCode', () => {
    const error = new EmmettError({ status: 404 });

    assertEqual(error.errorCode, 404);
  });

  void it('keeps the deprecated errorCode when the error is copied', () => {
    const error = new EmmettError({ status: 404 });

    assertEqual({ ...error }.errorCode, 404);
  });

  void it('still accepts errorCode in options', () => {
    const error = new EmmettError({ errorCode: 402, message: 'Pay first' });

    assertEqual(error.status, 402);
    assertEqual(error.message, 'Pay first');
  });

  void it('still accepts a number as status', () => {
    const error = new EmmettError(404);

    assertEqual(error.status, 404);
    assertEqual(
      error.message,
      `Error with status code '404' ocurred during Emmett processing`,
    );
  });

  void it('still accepts a string as message', () => {
    const error = new EmmettError('Something failed');

    assertEqual(error.status, 500);
    assertEqual(error.message, 'Something failed');
  });

  void it('uses internal server error status without options', () => {
    const error = new EmmettError();

    assertEqual(error.status, 500);
  });

  void it('carries the Emmett error type id', () => {
    assertTrue(hasTypeId(new EmmettError(), EmmettErrorTypeId));
    assertTrue(hasTypeId(new EmmettError(), emmettTypeId('EmmettError')));
  });

  void it('accepts only the documented options shape', () => {
    type Options = Exclude<
      ConstructorParameters<typeof EmmettError>[0],
      undefined | string | number
    >;

    expectTypeOf<{
      status: number;
      message?: string;
      code?: string;
      cause?: unknown;
      details?: Record<string, unknown>;
    }>().toExtend<Options>();
    expectTypeOf<{ errorCode: number; message?: string }>().toExtend<Options>();

    expectTypeOf<{ status: string }>().not.toExtend<Options>();
    expectTypeOf<{ status: number; code: number }>().not.toExtend<Options>();
    expectTypeOf<{ status: number; details: string }>().not.toExtend<Options>();
    expectTypeOf<{ message: string }>().not.toExtend<Options>();

    expectTypeOf<EmmettError['status']>().toEqualTypeOf<number>();
    expectTypeOf<EmmettError['code']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<EmmettError['details']>().toEqualTypeOf<
      Record<string, unknown> | undefined
    >();
  });
});

void describe('built-in Emmett errors', () => {
  const cause = new Error('Original failure');
  const details = { propertyId: 'property-1' };

  void it('ValidationError carries code, cause and details', () => {
    const error = new ValidationError({
      message: 'Invalid dates',
      code: 'INVALID_DATES',
      cause,
      details,
    });

    assertEqual(error.status, EmmettError.Codes.ValidationError);
    assertEqual(error.message, 'Invalid dates');
    assertEqual(error.code, 'INVALID_DATES');
    assertEqual(error.cause, cause);
    assertDeepEqual(error.details, details);
    assertTrue(error instanceof ValidationError);
  });

  void it('IllegalStateError carries code, cause and details', () => {
    const error = new IllegalStateError({
      message: 'Room is already booked',
      code: 'ROOM_ALREADY_BOOKED',
      cause,
      details,
    });

    assertEqual(error.status, EmmettError.Codes.IllegalStateError);
    assertEqual(error.message, 'Room is already booked');
    assertEqual(error.code, 'ROOM_ALREADY_BOOKED');
    assertEqual(error.cause, cause);
    assertDeepEqual(error.details, details);
    assertTrue(error instanceof IllegalStateError);
  });

  void it('NotFoundError carries code, cause and details', () => {
    const error = new NotFoundError({
      id: 'property-1',
      type: 'Property',
      code: 'PROPERTY_NOT_FOUND',
      cause,
      details,
    });

    assertEqual(error.status, EmmettError.Codes.NotFoundError);
    assertEqual(
      error.message,
      'Property with property-1 was not found during Emmett processing',
    );
    assertEqual(error.code, 'PROPERTY_NOT_FOUND');
    assertEqual(error.cause, cause);
    assertDeepEqual(error.details, details);
    assertTrue(error instanceof NotFoundError);
  });

  void it('ConcurrencyError carries code, cause and details', () => {
    const error = new ConcurrencyError('1', '2', {
      code: 'BOOKING_CHANGED',
      cause,
      details,
    });

    assertEqual(error.status, EmmettError.Codes.ConcurrencyError);
    assertEqual(error.message, 'Expected version 2 does not match current 1');
    assertEqual(error.code, 'BOOKING_CHANGED');
    assertEqual(error.cause, cause);
    assertDeepEqual(error.details, details);
    assertTrue(error instanceof ConcurrencyError);
  });

  void it('keep their current arguments', () => {
    const validation = new ValidationError('Invalid dates');
    const illegalState = new IllegalStateError('Already booked');
    const notFound = new NotFoundError({ id: 'property-1', type: 'Property' });
    const concurrency = new ConcurrencyError('1', '2', 'Booking changed');

    assertEqual(validation.status, 400);
    assertEqual(validation.message, 'Invalid dates');
    assertEqual(illegalState.status, 403);
    assertEqual(illegalState.message, 'Already booked');
    assertEqual(notFound.status, 404);
    assertEqual(
      notFound.message,
      'Property with property-1 was not found during Emmett processing',
    );
    assertEqual(concurrency.status, 412);
    assertEqual(concurrency.current, '1');
    assertEqual(concurrency.expected, '2');
    assertEqual(concurrency.message, 'Booking changed');
  });

  void it('carry the Emmett error type id', () => {
    assertTrue(hasTypeId(new ValidationError(), EmmettErrorTypeId));
    assertTrue(hasTypeId(new IllegalStateError(), EmmettErrorTypeId));
    assertTrue(hasTypeId(new NotFoundError(), EmmettErrorTypeId));
    assertTrue(hasTypeId(new ConcurrencyError('1', '2'), EmmettErrorTypeId));
    assertTrue(
      hasTypeId(new ConcurrencyInMemoryDatabaseError(), EmmettErrorTypeId),
    );
  });

  void it('keep their default messages', () => {
    assertEqual(
      new ValidationError().message,
      'Validation Error ocurred during Emmett processing',
    );
    assertEqual(
      new IllegalStateError().message,
      'Illegal State ocurred during Emmett processing',
    );
    assertEqual(
      new NotFoundError().message,
      'State was not found during Emmett processing',
    );
  });
});

void describe('EmmettError.mapFrom', () => {
  void it('returns an Emmett error unchanged', () => {
    const error = new IllegalStateError('Already booked');

    assertEqual(EmmettError.mapFrom(error), error);
  });

  void it('returns an error from another copy of Emmett unchanged', () => {
    const error = Object.assign(new Error('Conflict'), {
      status: 409,
      errorCode: 409,
      [Symbol.for('@event-driven-io/emmett/EmmettError')]: true,
    });

    assertEqual(EmmettError.mapFrom(error), error);
  });

  void it('maps an error with a numeric status to an Emmett error with that status', () => {
    const error = EmmettError.mapFrom({ status: 409, message: 'Conflict' });

    assertTrue(error instanceof EmmettError);
    assertEqual(error.status, 409);
    assertEqual(error.message, 'Conflict');
  });

  void it('maps an error with a numeric errorCode to an Emmett error with that status', () => {
    const error = EmmettError.mapFrom({ errorCode: 402, message: 'Pay' });

    assertTrue(error instanceof EmmettError);
    assertEqual(error.status, 402);
    assertEqual(error.message, 'Pay');
  });

  void it('maps a copied Emmett error to an Emmett error with the same status', () => {
    const original = new NotFoundError({ id: 'property-1', type: 'Property' });

    const error = EmmettError.mapFrom({ ...original });

    assertTrue(error instanceof EmmettError);
    assertEqual(error.status, 404);
  });

  void it('keeps the stack trace of the mapped error', () => {
    const original = new Error('Upstream failed');

    const error = EmmettError.mapFrom(original);

    assertEqual(original.stack, error.stack);
  });

  void it('maps an error without status to internal server error and keeps code, cause and details', () => {
    const cause = new Error('Socket closed');
    const original = Object.assign(new Error('Upstream failed', { cause }), {
      code: 'UPSTREAM_FAILED',
      details: { service: 'payments' },
    });

    const error = EmmettError.mapFrom(original);

    assertTrue(error instanceof EmmettError);
    assertEqual(error.status, 500);
    assertEqual(error.message, 'Upstream failed');
    assertEqual(error.code, 'UPSTREAM_FAILED');
    assertEqual(error.cause, cause);
    assertDeepEqual(error.details, { service: 'payments' });
  });

  void it('uses a default message when the source has none', () => {
    const error = EmmettError.mapFrom({});

    assertEqual(error.status, 500);
    assertEqual(error.message, 'An unknown error occurred');
  });
});

void describe('EmmettError.isInstanceOf', () => {
  void it('matches an error with a numeric status', () => {
    assertTrue(EmmettError.isInstanceOf({ status: 412 }));
    assertTrue(
      EmmettError.isInstanceOf(
        { status: 412 },
        EmmettError.Codes.ConcurrencyError,
      ),
    );
    assertFalse(
      EmmettError.isInstanceOf(
        { status: 412 },
        EmmettError.Codes.NotFoundError,
      ),
    );
  });

  void it('matches an error with a numeric errorCode', () => {
    assertTrue(EmmettError.isInstanceOf({ errorCode: 404 }));
    assertTrue(
      EmmettError.isInstanceOf(
        { errorCode: 404 },
        EmmettError.Codes.NotFoundError,
      ),
    );
    assertFalse(
      EmmettError.isInstanceOf(
        { errorCode: 404 },
        EmmettError.Codes.ValidationError,
      ),
    );
  });

  void it('matches Emmett errors by their status', () => {
    assertTrue(
      EmmettError.isInstanceOf(
        new ConcurrencyError('1', '2'),
        EmmettError.Codes.ConcurrencyError,
      ),
    );
  });

  void it('does not match values without a numeric status or errorCode', () => {
    assertFalse(EmmettError.isInstanceOf(new Error('Plain')));
    assertFalse(EmmettError.isInstanceOf({ status: '404' }));
    assertFalse(EmmettError.isInstanceOf(null));
    assertFalse(EmmettError.isInstanceOf('error'));
  });
});
