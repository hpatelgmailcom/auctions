/**
 * auth.js — one-time interactive Gmail OAuth.
 *
 * Usage: npm run email:auth   (or: node auctions/email/auth.js)
 *
 * Opens a browser via the loopback flow, then writes token.json (including the
 * refresh token) next to this file. Re-run only if the token is revoked.
 */

import fs from 'fs';
import { authenticate } from '@google-cloud/local-auth';
import { CREDENTIALS_PATH, TOKEN_PATH, SCOPES } from './gmail.js';

async function main() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(
      `Missing ${CREDENTIALS_PATH}\n\n` +
      'Setup (one time):\n' +
      '  1. console.cloud.google.com → create/select a project\n' +
      '  2. APIs & Services → Library → enable "Gmail API"\n' +
      '  3. APIs & Services → Credentials → Create credentials → OAuth client ID → Desktop app\n' +
      '  4. Download the JSON and save it as auctions/email/credentials.json\n'
    );
    process.exit(1);
  }

  const client = await authenticate({ scopes: SCOPES, keyfilePath: CREDENTIALS_PATH });
  if (!client.credentials.refresh_token) {
    console.warn('Warning: no refresh_token issued — delete the app from myaccount.google.com/permissions and re-run.');
  }
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(client.credentials, null, 2));
  console.log(`Token saved → ${TOKEN_PATH}`);
}

main().catch(err => { console.error('Auth failed:', err.message); process.exit(1); });
