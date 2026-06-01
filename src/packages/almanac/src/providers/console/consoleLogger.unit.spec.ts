import { describe, expect, it, vi } from 'vitest';
import { LogEvent } from '../../loggers/logger';
import { consoleLogger } from './consoleLogger';

describe('consoleLogger', () => {
  it('info delegates to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleLogger(LogEvent.info('hello'));
    expect(spy).toHaveBeenCalledWith('hello');
    spy.mockRestore();
  });

  it('error delegates to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogger(LogEvent.error('something failed'));
    expect(spy).toHaveBeenCalledWith('something failed');
    spy.mockRestore();
  });

  it('fatal delegates to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogger(LogEvent.fatal('fatal failure'));
    expect(spy).toHaveBeenCalledWith('fatal failure');
    spy.mockRestore();
  });

  it('warn delegates to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleLogger(LogEvent.warn('watch out'));
    expect(spy).toHaveBeenCalledWith('watch out');
    spy.mockRestore();
  });

  it('passes object + msg to the underlying console method', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleLogger(LogEvent.info({ userId: 'u1' }, 'user logged in'));
    expect(spy).toHaveBeenCalledWith('user logged in', { userId: 'u1' });
    spy.mockRestore();
  });

  it('passes Error + msg to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('boom');
    consoleLogger(LogEvent.error(err, 'operation failed'));
    expect(spy).toHaveBeenCalledWith('operation failed', err);
    spy.mockRestore();
  });

  it('silent does nothing', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleLogger(LogEvent.silent('shh'));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
