/** Runtime-only credentials: never persist account values, storage state, traces or screenshots. */
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const path = require('node:path');
const envFile = process.env.PMC_E2E_ENV_FILE;
if (!envFile) { console.error('Set PMC_E2E_ENV_FILE to the existing secure credentials file.'); process.exit(1); }
let credentials;
try { credentials = dotenv.parse(fs.readFileSync(envFile)); }
catch { console.error('Unable to read E2E credentials file.'); process.exit(1); }
if (!credentials.PMC_E2E_USERNAME || !credentials.PMC_E2E_PASSWORD) { console.error('E2E credential fields are missing.'); process.exit(1); }
const result = spawnSync('pnpm', ['--filter', '@tracker/web', 'exec', 'playwright', 'test', 'e2e/pmc-rd-progress.real.spec.ts', '--workers=1', '--reporter=dot', ...process.argv.slice(2)], {
  cwd: path.resolve(__dirname, '..'), stdio: 'inherit',
  env: { ...process.env, PMC_E2E_USERNAME: credentials.PMC_E2E_USERNAME, PMC_E2E_PASSWORD: credentials.PMC_E2E_PASSWORD,
    E2E_BASE_URL: process.env.E2E_BASE_URL || credentials.PMC_E2E_BASE_URL, PLAYWRIGHT_NO_COPY_PROMPT: '1' }
});
process.exit(result.status ?? 1);
