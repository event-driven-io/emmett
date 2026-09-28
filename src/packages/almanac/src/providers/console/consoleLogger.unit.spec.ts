import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { LogEvent } from '../../loggers/logger';
import { consoleLogger } from './consoleLogger';

describe('consoleLogger', () => {
  let stdout!: MockInstance<typeof console.log>;
  let stderr!: MockInstance<typeof console.error>;
  let stackTrace!: MockInstance<typeof console.trace>;

  beforeEach(() => {
    stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    stackTrace = vi.spyOn(console, 'trace').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const everyLevel = [
    LogEvent.trace('trace message'),
    LogEvent.debug('debug message'),
    LogEvent.info('info message'),
    LogEvent.warn('warn message'),
    LogEvent.error('error message'),
    LogEvent.fatal('fatal message'),
  ];

  it('writes every level to stdout by default', () => {
    const log = consoleLogger({ minLevel: 'trace' });

    for (const event of everyLevel) log(event);

    expect(stdout.mock.calls).toEqual([
      ['trace message'],
      ['debug message'],
      ['info message'],
      ['warn message'],
      ['error message'],
      ['fatal message'],
    ]);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('writes every level to stderr when destination is stderr', () => {
    const log = consoleLogger({ destination: 'stderr', minLevel: 'trace' });

    for (const event of everyLevel) log(event);

    expect(stderr.mock.calls).toEqual([
      ['trace message'],
      ['debug message'],
      ['info message'],
      ['warn message'],
      ['error message'],
      ['fatal message'],
    ]);
    expect(stdout).not.toHaveBeenCalled();
  });

  it('does not print a stack trace for trace-level events', () => {
    const log = consoleLogger({ minLevel: 'trace' });

    log(LogEvent.trace('entering handler'));

    expect(stackTrace).not.toHaveBeenCalled();
    expect(stdout.mock.calls).toEqual([['entering handler']]);
  });

  it('drops debug events unless minLevel allows them', () => {
    consoleLogger()(LogEvent.debug('dropped'));
    consoleLogger({ minLevel: 'debug' })(LogEvent.debug('kept'));

    expect(stdout.mock.calls).toEqual([['kept']]);
  });

  it('passes object + msg to the console', () => {
    consoleLogger()(LogEvent.info({ userId: 'u1' }, 'user logged in'));

    expect(stdout.mock.calls).toEqual([['user logged in', { userId: 'u1' }]]);
  });

  it('passes Error + msg to the console', () => {
    const err = new Error('boom');

    consoleLogger()(LogEvent.error(err, 'operation failed'));

    expect(stdout.mock.calls).toEqual([['operation failed', err]]);
  });

  it('silent does nothing', () => {
    consoleLogger({ minLevel: 'trace' })(LogEvent.silent('shh'));

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });
});
