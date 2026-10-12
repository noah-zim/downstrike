#!/usr/bin/env node
// Put a clip up for approval: a GitHub pre-release (so it plays on a phone with
// one tap) plus an issue that @-mentions the owner, who replies /post or /skip.
//   node candidate.mjs out
// Needs GH_TOKEN, GITHUB_REPOSITORY and GITHUB_REPOSITORY_OWNER (Actions sets them).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { issueTitle, buildIssueBody } from './issue.mjs';

export function clipTag(meta) {
  const slug = meta.place.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^lightning (over|near) /, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const stamp = meta.filmedAt.replace(/[-:]/g, '').slice(0, 13); // 20261008T2357
  return `clip-${stamp}-${slug || 'storm'}`;
}

// note: optional line shown at the top of the issue (why it wasn't auto-posted)
export function openApprovalIssue(dir, { note = '' } = {}) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const caption = fs.readFileSync(path.join(dir, 'caption.txt'), 'utf8').trim();
  const repo = process.env.GITHUB_REPOSITORY;
  const owner = process.env.GITHUB_REPOSITORY_OWNER || repo.split('/')[0];
  const gh = (...args) => execFileSync('gh', [...args, '--repo', repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

  meta.tag = clipTag(meta);
  gh('release', 'create', meta.tag, path.join(dir, 'clip.mp4'), path.join(dir, 'cover.jpg'),
    '--prerelease', '--latest=false',
    '--title', `Clip: ${meta.place.title}, ${meta.when}`,
    '--notes', 'Promo clip waiting for approval in the matching issue. Lightning data: Blitzortung.org volunteers. Map © CARTO © OpenStreetMap contributors.');
  try { gh('label', 'create', 'promo', '--color', 'FFD54F', '--description', 'Downstrike clip waiting for a yes'); } catch (e) {}

  const dl = (f) => `https://github.com/${repo}/releases/download/${meta.tag}/${f}`;
  const bodyFile = path.join(os.tmpdir(), `promo-issue-${Date.now()}.md`);
  fs.writeFileSync(bodyFile, buildIssueBody({
    meta, caption, owner, note,
    videoUrl: dl('clip.mp4'), coverUrl: dl('cover.jpg'),
    releaseUrl: `https://github.com/${repo}/releases/tag/${meta.tag}`,
  }));
  const url = gh('issue', 'create', '--title', issueTitle(meta), '--body-file', bodyFile, '--label', 'promo');
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return url;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] || 'out');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  if (meta.skipped) { console.log(`no clip: ${meta.skipped}`); process.exit(0); }
  console.log(`approval issue: ${openApprovalIssue(dir)}`);
}
