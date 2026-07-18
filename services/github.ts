import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Octokit } from 'octokit';
import { writePrBody } from '../lib/ai';
import { getAuditJob, getFixesForAudit, getPages } from '../lib/db';
import { AppError } from '../lib/errors';
import { log } from '../lib/log';
import { PATCHED_DIR } from '../lib/paths';

// URL → repo path mapping for the demo repo (PRD §21 T-A3.3 DEMO_REPO_MAP).
// Demo site pages are flat files; anything else maps by basename, default index.html.
const DEMO_REPO_MAP = (pageUrl: string): string => {
  const base = pageUrl.split('/').pop() ?? '';
  return base.endsWith('.html') ? base : 'index.html';
};

/**
 * Opens a real PR on GH_DEMO_REPO: branch aloud/fixes-<auditId> (suffix -2, -3 on
 * collision), commits the patched pages, body via writePrBody. Calls GitHub + model APIs.
 */
export async function openFixPr(auditId: string): Promise<string> {
  const token = process.env.GH_TOKEN ?? '';
  const repoFull = process.env.GH_DEMO_REPO ?? '';
  if (token === '' || repoFull === '') {
    throw new AppError('INTERNAL', 'GH_TOKEN / GH_DEMO_REPO not configured');
  }
  const [owner, repo] = repoFull.split('/');

  const job = getAuditJob(auditId);
  if (!job || job.status !== 'done') throw new AppError('INTERNAL', 'Audit not found');
  if (job.scoreAfter === undefined) {
    throw new AppError('INTERNAL', 'Run the fix + re-audit loop before opening a PR');
  }
  const fixes = getFixesForAudit(auditId).filter((f) => f.applied);
  if (fixes.length === 0) throw new AppError('INTERNAL', 'No applied fixes to commit');
  const pages = getPages(auditId);
  const issueById = new Map(pages.flatMap((p) => p.issues).map((i) => [i.id, i]));

  const octokit = new Octokit({ auth: token });
  const { data: repoInfo } = await octokit.rest.repos.get({ owner, repo });
  const base = repoInfo.default_branch;
  const { data: baseRef } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${base}` });

  // Branch with collision suffixes: aloud/fixes-<id>, -2, -3…
  let branch = `aloud/fixes-${auditId}`;
  for (let attempt = 2; attempt <= 5; attempt += 1) {
    try {
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: baseRef.object.sha,
      });
      break;
    } catch {
      branch = `aloud/fixes-${auditId}-${attempt}`;
    }
  }

  // Commit each patched page to its mapped path.
  for (const page of pages) {
    let content: string;
    try {
      content = readFileSync(join(PATCHED_DIR, `${page.id}.html`), 'utf8');
    } catch {
      continue; // page had no patched copy
    }
    const path = DEMO_REPO_MAP(page.url);
    let existingSha: string | undefined;
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });
      if (!Array.isArray(data) && data.type === 'file') existingSha = data.sha;
    } catch {
      // new file
    }
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      branch,
      message: `fix(a11y): patch ${path} (audit ${auditId})`,
      content: Buffer.from(content).toString('base64'),
      ...(existingSha === undefined ? {} : { sha: existingSha }),
      committer: { name: 'Aloud', email: 'aloud@users.noreply.github.com' },
    });
  }

  const body = await writePrBody(
    fixes.map((f) => ({
      rule: issueById.get(f.issueId)?.rule ?? 'fix',
      rationale: f.rationale,
    })),
    { before: job.scoreBefore ?? 0, after: job.scoreAfter },
  );

  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    base,
    head: branch,
    title: `Accessibility fixes: AccessScore ${job.scoreBefore} → ${job.scoreAfter}`,
    body,
  });

  log(auditId, 'pr-opened', 0, { url: pr.html_url, fixes: fixes.length });
  return pr.html_url;
}
