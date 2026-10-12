#!/usr/bin/env node
// Runs when the repo owner comments on a promo issue (see promo-approve.yml).
//   /post            post the clip on X
//   /post anyway     ...even if it is older than maxPostAgeHours
//   /skip            delete the clip and close the issue
//   /caption <text>  replace the post text in the issue
// Env: ISSUE_NUMBER, COMMENT_ID, COMMENT_BODY, GH_TOKEN, GITHUB_REPOSITORY,
//      X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET.
// Posting is at most once per issue: the "posting" label goes on before
// anything is sent to X and only comes off if X never published.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCommand, parseIssueBody, replaceCaption } from './issue.mjs';
import { postVideo, keysFromEnv, scrubber } from './x.mjs';
import { captionProblem } from './caption.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
const repo = process.env.GITHUB_REPOSITORY;
const n = process.env.ISSUE_NUMBER;
const gh = (...args) => execFileSync('gh', [...args, '--repo', repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
// anything said in the (public) issue is scrubbed of the keys first
const scrub = scrubber();
const say = (text) => gh('issue', 'comment', n, '--body', scrub(text));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-'));

const cmd = parseCommand(process.env.COMMENT_BODY);
if (!cmd) process.exit(0);
if (process.env.COMMENT_ID) { // 👀 = seen, so a dropped command is obvious
  try {
    execFileSync('gh', ['api', '-X', 'POST', `repos/${repo}/issues/comments/${process.env.COMMENT_ID}/reactions`, '-f', 'content=eyes'], { stdio: 'ignore' });
  } catch (e) {}
}

const issue = JSON.parse(gh('issue', 'view', n, '--json', 'body,labels,state'));
const labels = issue.labels.map((l) => l.name);
if (issue.state !== 'OPEN' || labels.includes('posted') || labels.includes('skipped')) {
  say('This clip is already done (posted or skipped). Nothing to do.');
  process.exit(0);
}
if (labels.includes('posting')) {
  say('A post is already running for this clip, or one was interrupted. If the post never appeared on X, remove the `posting` label and comment `/post` again.');
  process.exit(0);
}
let meta, caption;
try {
  ({ meta, caption } = parseIssueBody(issue.body));
} catch (e) {
  say(`I can't read this issue anymore: ${e.message}. Was the caption block or the hidden line at the end edited away?`);
  process.exit(1);
}

if (cmd.cmd === 'skip') {
  try { gh('release', 'delete', meta.tag, '--yes', '--cleanup-tag'); } catch (e) {}
  try { gh('label', 'create', 'skipped', '--color', '8A93A5'); } catch (e) {}
  gh('issue', 'edit', n, '--add-label', 'skipped');
  gh('issue', 'close', n, '--comment', 'Skipped. The clip and its release are deleted.');
  process.exit(0);
}

if (cmd.cmd === 'caption') {
  const f = path.join(tmp, 'body.md');
  fs.writeFileSync(f, replaceCaption(issue.body, cmd.text));
  gh('issue', 'edit', n, '--body-file', f);
  const problem = captionProblem(cmd.text);
  say(problem ? `Post text updated, but it is ${problem}. X will refuse it; trim it with another \`/caption …\`.` : 'Post text updated. Comment `/post` when it reads right.');
  process.exit(0);
}

// ---- /post ----
const ageH = (Date.now() - Date.parse(meta.filmedAt)) / 3600e3;
if (ageH > cfg.maxPostAgeHours && !cmd.anyway) {
  say(`This clip is ${ageH.toFixed(1)} hours old, so "right now" is no longer true. Comment \`/post anyway\` to post it regardless, or \`/skip\`.`);
  process.exit(0);
}
const problem = captionProblem(caption);
if (problem) {
  say(`The post text is ${problem}. Fix it with \`/caption …\` (280 characters, no links or domain names).`);
  process.exit(0);
}

try { gh('label', 'create', 'posting', '--color', 'FFAB00'); } catch (e) {}
try { gh('label', 'create', 'posted', '--color', '2EA043'); } catch (e) {}
gh('issue', 'edit', n, '--add-label', 'posting');
let published = null;
try {
  gh('release', 'download', meta.tag, '--pattern', 'clip.mp4', '--dir', tmp);
  published = await postVideo({ file: path.join(tmp, 'clip.mp4'), text: caption, keys: keysFromEnv(), log: (m) => console.log(scrub(m)) });
  gh('issue', 'edit', n, '--remove-label', 'posting', '--add-label', 'posted');
  gh('issue', 'close', n, '--comment', `Posted on X ✅ ${published.url || ''}`);
} catch (e) {
  console.error(scrub(e.stack || e.message));
  if (published) { // it's live; never invite a second post
    say(`Posted (${published.url}), but tidying up the issue failed: ${e.message}`);
    process.exit(1);
  }
  if (e.maybePublished) { // X may have posted before the error; leave "posting" on
    say(`Not sure this posted: ${e.message}\n\nCheck the X account. If the post isn't there, remove the \`posting\` label and comment \`/post\` again.`);
    process.exit(1);
  }
  try { gh('issue', 'edit', n, '--remove-label', 'posting'); } catch (e2) {}
  say(`Posting failed: ${e.message}\n\nNothing was published. Fix the cause (see the workflow log), then comment \`/post\` again.`);
  process.exit(1);
}
