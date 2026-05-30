import { checkUrl, waitFor } from '../index';

export type HttpHealthCheckOptions = {
  validate?: (res: Response) => Promise<boolean> | boolean;
  timeout?: number;
};

// Builds a readiness probe: polls `url` until it responds (or `validate` passes),
// throwing on timeout. Wraps `waitFor` + `checkUrl` so the polling and diagnostic
// logging stay identical to the inline checks.
export const httpHealthCheck =
  (label: string, url: string, opts?: HttpHealthCheckOptions) =>
  async (): Promise<void> => {
    await waitFor(() => checkUrl(label, url, opts?.validate), {
      timeout: opts?.timeout ?? 60_000,
      label,
    });
  };
