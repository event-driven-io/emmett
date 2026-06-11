import type { LogInput, LogLevel } from '../../tracers';

export type OtelLogInput = Omit<LogInput, 'level'> &
  (
    | {
        level: LogLevel;
        severityNumber?: never;
        severityText?: never;
      }
    | {
        level?: never;
        severityNumber: number;
        severityText: string;
      }
  );
