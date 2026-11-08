'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const mock = spawn(process.execPath, [path.join(__dirname, 's4-mock-server.js')], {
  cwd: root,
  env: process.env,
  stdio: 'inherit'
});

const cap = spawn('npm run start:local', [], {
  cwd: root,
  env: {
    ...process.env,
    S4_MODE: 'remote',
    S4_API_URL: process.env.S4_API_URL || 'http://localhost:4005/odata4/purchase-order',
    S4_COMPANY_CODE: process.env.S4_COMPANY_CODE || '1710',
    S4_PURCHASING_ORG: process.env.S4_PURCHASING_ORG || '1710',
    S4_PURCHASING_GROUP: process.env.S4_PURCHASING_GROUP || '001',
    S4_PLANT: process.env.S4_PLANT || '1710'
  },
  stdio: 'inherit',
  shell: true
});

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (!mock.killed) mock.kill();
  if (!cap.killed) cap.kill();
  setTimeout(() => process.exit(exitCode), 250);
}

mock.on('exit', code => {
  if (!stopping && code) stop(code);
});
cap.on('exit', code => stop(code || 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
