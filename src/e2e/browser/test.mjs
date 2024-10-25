import express from 'express';
import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import path from 'path';
import { chromium } from 'playwright';

describe('Browser environment tests', () => {
  let server;
  let browser;
  let page;

  const PORT = 8080;
  const app = express();
  app.use(express.static(path.resolve('.')));

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(PORT, resolve);
    });
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    page = await browser.newPage();
  });

  after(async () => {
    await browser.close();
    server.close();
  });

  it('should load the package correctly in the browser environment', async () => {
    await page.goto(`http://localhost:${PORT}/index.html`);
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
});
