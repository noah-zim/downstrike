#!/usr/bin/env node
// Weekly check (promo-token.yml): is the Instagram token still good?
// In instagram mode it also refreshes the 60-day token and, if PROMO_PAT is set
// (a fine-grained token with Secrets: write on this repo), saves the new one.
// Facebook mode with a Page or system-user token normally never expires; this
// just proves it still works. A failure fails the workflow, and GitHub emails you.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkAccount } from './publish.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
const mode = process.env.IG_API || 'facebook';
const userId = process.env.IG_USER_ID;
const token = process.env.IG_ACCESS_TOKEN;
if (!userId || !token) {
  console.log('IG_USER_ID / IG_ACCESS_TOKEN not set yet; nothing to check.');
  process.exit(0);
}

const acct = await checkAccount({ mode, userId, token, version: cfg.graphVersion });
console.log(`token works for @${acct.username} (${mode} mode)`);

if (mode === 'instagram') {
  const res = await fetch(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token })}`);
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`refresh failed: ${(j.error && j.error.message) || res.status}`);
  const days = Math.round(j.expires_in / 86400);
  if (process.env.PROMO_PAT) {
    execFileSync('gh', ['secret', 'set', 'IG_ACCESS_TOKEN', '--repo', process.env.GITHUB_REPOSITORY], {
      input: j.access_token, env: { ...process.env, GH_TOKEN: process.env.PROMO_PAT }, stdio: ['pipe', 'inherit', 'inherit'],
    });
    console.log(`refreshed and saved; good for ${days} more days`);
  } else {
    console.log(`refreshed, but PROMO_PAT is not set, so the stored token still expires on its old date (new one valid ${days} days, not saved)`);
  }
}
