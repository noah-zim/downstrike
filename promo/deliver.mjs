#!/usr/bin/env node
// After a capture: post the clip to X straight away, or ask first.
//   node deliver.mjs out
// It asks first (an approval issue) when any of these hold:
//   - the repo variable PROMO_AUTOPOST is "false"
//   - the National Weather Service has warnings out where the storm is
//     (people may be in danger; a human should choose the words)
//   - the X keys aren't set yet
//   - posting fails (the issue says why, and /post retries)
// Env: GH_TOKEN, GITHUB_REPOSITORY, PROMO_AUTOPOST, X_API_KEY, X_API_SECRET,
//      X_ACCESS_TOKEN, X_ACCESS_SECRET, GITHUB_STEP_SUMMARY (optional).

import fs from 'node:fs';
import path from 'node:path';
import { openApprovalIssue } from './candidate.mjs';
import { postVideo, keysFromEnv, scrubber } from './x.mjs';

const dir = path.resolve(process.argv[2] || 'out');
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
if (meta.skipped) { console.log(`no clip: ${meta.skipped}`); process.exit(0); }
const caption = fs.readFileSync(path.join(dir, 'caption.txt'), 'utf8').trim();
const keys = keysFromEnv();
const scrub = scrubber();
const summary = (line) => {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + '\n');
};

let reason = null;
if (process.env.PROMO_AUTOPOST === 'false') reason = 'Auto-posting is off (repo variable PROMO_AUTOPOST is "false").';
else if (meta.safety !== 'none') reason = `The National Weather Service has warnings out here (${meta.alerts.map((a) => a.event).join(', ')}). Check the words before posting.`;
else if (!Object.values(keys).every(Boolean)) reason = 'The X keys are not set yet, so I could not post. Add them as repo secrets, then comment `/post`.';

if (!reason) {
  try {
    const { url } = await postVideo({ file: path.join(dir, 'clip.mp4'), text: caption, keys, log: (m) => console.log(scrub(m)) });
    summary(`Posted to X: ${url}\n\n${meta.place.title}, ${meta.stats.strikes10} strikes in 10 min, ${meta.when}.`);
    process.exit(0);
  } catch (e) {
    console.error(scrub(e.stack || e.message));
    if (e.maybePublished) {
      reason = `Posting may have gone through before an error (${scrub(e.message)}). Check the X account before using \`/post\`, or it may post twice.`;
    } else {
      reason = `Posting failed: ${scrub(e.message)}. Nothing was published; fix the cause, then comment \`/post\`.`;
    }
  }
}

const url = openApprovalIssue(dir, { note: reason });
summary(`Waiting for approval: ${url}\n\n${reason}`);
