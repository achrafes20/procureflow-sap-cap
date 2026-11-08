'use strict';

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test/ui',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4010',
    headless: true,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npx cds-serve --profile test --port 4010',
    url: 'http://127.0.0.1:4010/index.html',
    reuseExistingServer: false,
    timeout: 120000
  }
});
