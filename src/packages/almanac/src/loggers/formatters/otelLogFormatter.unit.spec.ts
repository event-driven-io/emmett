import { describe, expect, it } from 'vitest';
import { severityNumberFor, severityTextFor } from './otelLogFormatter';

describe('severity helpers', () => {
  it('maps each level to its OTel severity number', () => {
    expect(severityNumberFor('trace')).toBe(1);
    expect(severityNumberFor('debug')).toBe(5);
    expect(severityNumberFor('info')).toBe(9);
    expect(severityNumberFor('warn')).toBe(13);
    expect(severityNumberFor('error')).toBe(17);
    expect(severityNumberFor('fatal')).toBe(21);
    expect(severityNumberFor('silent')).toBe(0);
  });

  it('maps each level to its uppercase severity text', () => {
    expect(severityTextFor('info')).toBe('INFO');
    expect(severityTextFor('error')).toBe('ERROR');
  });
});
