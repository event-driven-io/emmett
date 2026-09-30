import { assertThatArray } from '@event-driven-io/emmett';
import { describe, it } from 'vitest';
import { getApplication, startAPI } from '..';

void describe('Server listening E2E', () => {
  void it("logs the listening line through Fastify's logger enabled in serverOptions", async () => {
    const lines: string[] = [];

    const app = await getApplication({
      serverOptions: {
        logger: { stream: { write: (line: string) => lines.push(line) } },
      },
    });

    try {
      await startAPI(app, { port: 0 });

      assertThatArray(
        lines
          .map((line) => JSON.parse(line) as { level: number; msg: string })
          .filter(({ msg }) => msg.startsWith('Server listening'))
          .map(({ level, msg }) => ({ level, msg })),
      ).containsExactlyInAnyOrder(
        app.addresses().map(({ address, family, port }) => ({
          level: 30,
          msg: `Server listening at http://${family === 'IPv6' ? `[${address}]` : address}:${port}`,
        })),
      );
    } finally {
      await app.close();
    }
  });
});
