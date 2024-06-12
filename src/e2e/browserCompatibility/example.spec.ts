import { expect, test } from '@playwright/test';

const startServer = () => {
  var express = require('express');
  var app = express();
  var path = require('path');

  app.use(express.static(path.join(__dirname)));

  app.listen(5555);
};

test('should load the bundle and verify functionality', async ({ page }) => {
  startServer();

  const errorLogs: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errorLogs.push(message.text());
    }
  });

  // Navigate to the local file URL
  await page.goto('http://localhost:5555');

  // Check if the global variable MyBundle is defined
  const isBundleLoaded = await page.evaluate(() => {
    console.log('WINDOW');
    console.log((window as any).eventStore);
    return (window as any).eventStore !== 'undefined';
  });
  console.log(errorLogs);
  console.log('isBundleloaded' + isBundleLoaded);
  expect(errorLogs.length).toBe(0);

  expect(isBundleLoaded).toBe(true);
});
