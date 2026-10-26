import express from 'express';
import assert from 'node:assert';
import path from 'path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, it } from 'vitest';

describe('Browser environment tests', () => {
  let server;
  let browser;
  let page;
  const pageErrors = [];

  const PORT = 8080;
  const app = express();
  app.use(express.static(path.resolve('.')));

  beforeAll(async () => {
    await new Promise((resolve) => {
      server = app.listen(PORT, resolve);
    });
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    page = await browser.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
  });

  afterAll(async () => {
    await browser.close();
    server.close();
  });

  it('should load the package correctly in the browser environment', async () => {
    await page.goto(`http://localhost:${PORT}/index.html`);
    await page.waitForFunction(() => window.events !== undefined);
    const isLoaded = await page.evaluate(
      () => typeof window.eventStore !== 'undefined',
    );
    assert.strictEqual(
      isLoaded,
      true,
      '❌ Package failed to load in the browser environment.',
    );
    console.log('✅ Package loaded successfully in the browser environment.');
  });

  it('should append and read events in the browser environment', async () => {
    await page.waitForFunction(() => window.events !== undefined);
    const events = await page.evaluate(() => window.events);
    assert.deepStrictEqual(events, [{ type: 'Counted', data: { by: 2 } }]);
    assert.deepStrictEqual(pageErrors, []);
  });
});
