#!/usr/bin/env node
// After a capture: put the clip up as a GitHub pre-release (so it plays on a
// phone with one tap) and open the approval issue that @-mentions the owner.
//   node candidate.mjs out
// Needs GH_TOKEN, GITHUB_REPOSITORY and GITHUB_REPOSITORY_OWNER (Actions sets them).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { issueTitle, buildIssueBody } from './issue.mjs';

const dir = path.resolve(process.argv[2] || 'out');
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
if (meta.skipped) { console.log(`no clip: ${meta.skipped}`); process.exit(0); }
const caption = fs.readFileSync(path.join(dir, 'caption.txt'), 'utf8').trim();
const repo = process.env.GITHUB_REPOSITORY;
const owner = process.env.GITHUB_REPOSITORY_OWNER || repo.split('/')[0];
const gh = (...args) => execFileSync('gh', [...args, '--repo', repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

const slug = meta.place.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/^lightning (over|near) /, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
const stamp = meta.filmedAt.replace(/[-:]/g, '').slice(0, 13); // 20261008T2357
meta.tag = `clip-${stamp}-${slug || 'storm'}`;

gh('release', 'create', meta.tag, path.join(dir, 'clip.mp4'), path.join(dir, 'cover.jpg'),
  '--prerelease', '--latest=false',
  '--title', `Clip: ${meta.place.title}, ${meta.when}`,
  '--notes', 'Promo clip waiting for approval in the matching issue. Lightning data: Blitzortung.org volunteers. Map © CARTO © OpenStreetMap contributors.');

const dl = (f) => `https://github.com/${repo}/releases/download/${meta.tag}/${f}`;
try {
  gh('label', 'create', 'promo', '--color', 'FFD54F', '--description', 'Downstrike clip waiting for a yes');
} catch (e) { /* already exists */ }

const bodyFile = path.join(os.tmpdir(), `promo-issue-${Date.now()}.md`);
fs.writeFileSync(bodyFile, buildIssueBody({
  meta, caption, owner,
  videoUrl: dl('clip.mp4'), coverUrl: dl('cover.jpg'),
  releaseUrl: `https://github.com/${repo}/releases/tag/${meta.tag}`,
}));
const url = gh('issue', 'create', '--title', issueTitle(meta), '--body-file', bodyFile, '--label', 'promo');
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(`approval issue: ${url}`);
