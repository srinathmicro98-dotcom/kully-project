import { config } from '../config.js';

const API = 'https://api.github.com';

function assertConfigured() {
  if (!config.githubToken) {
    throw new Error('GitHub integration is not configured (no GITHUB_TOKEN set).');
  }
}

function assertAllowed(owner, repo) {
  const full = `${owner}/${repo}`;
  if (!config.githubAllowedRepos.includes(full)) {
    throw new Error(`repo "${full}" is not in GITHUB_ALLOWED_REPOS — refusing to touch it`);
  }
}

function headers(hasBody) {
  return {
    Authorization: `Bearer ${config.githubToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function gh(path, options = {}) {
  const res = await fetch(`${API}${path}`, { ...options, headers: headers(!!options.body) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${options.method || 'GET'} ${path} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function ghMaybe(path) {
  const res = await fetch(`${API}${path}`, { headers: headers(false) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API GET ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function refQuery(branch) {
  return branch ? `?ref=${encodeURIComponent(branch)}` : '';
}

async function getDefaultBranch(owner, repo) {
  return (await gh(`/repos/${owner}/${repo}`)).default_branch;
}

async function ensureBranch({ owner, repo, branch }) {
  const existing = await ghMaybe(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (existing) return { created: false, sha: existing.object.sha };

  const defaultBranch = await getDefaultBranch(owner, repo);
  const baseRef = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`);
  const created = await gh(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }),
  });
  return { created: true, sha: created.object.sha };
}

export async function githubReadFile({ owner, repo, path, branch }) {
  assertConfigured();
  assertAllowed(owner, repo);

  const data = await ghMaybe(`/repos/${owner}/${repo}/contents/${encodePath(path)}${refQuery(branch)}`);
  if (!data) return { error: `no such file: ${path}` };
  if (Array.isArray(data)) return { error: `${path} is a directory — use github_list_files` };
  return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
}

export async function githubListFiles({ owner, repo, path = '', branch }) {
  assertConfigured();
  assertAllowed(owner, repo);

  const data = await ghMaybe(`/repos/${owner}/${repo}/contents/${encodePath(path)}${refQuery(branch)}`);
  if (!data) return { files: [] };
  if (!Array.isArray(data)) return { error: `${path} is a file, not a directory` };
  return { files: data.map((f) => ({ name: f.name, path: f.path, type: f.type })) };
}

// Feature branches only — writing directly to the default branch is refused.
// The branch is created from the default branch's current tip if it doesn't
// exist yet, so the model doesn't need a separate "create branch" step.
export async function githubWriteFile({ owner, repo, path, content, message, branch }) {
  assertConfigured();
  assertAllowed(owner, repo);

  const defaultBranch = await getDefaultBranch(owner, repo);
  if (branch === defaultBranch) {
    throw new Error(`refusing to write directly to the default branch (${defaultBranch}) — use a feature branch`);
  }

  await ensureBranch({ owner, repo, branch });

  const existing = await ghMaybe(`/repos/${owner}/${repo}/contents/${encodePath(path)}${refQuery(branch)}`);
  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
    ...(existing && !Array.isArray(existing) ? { sha: existing.sha } : {}),
  };

  const result = await gh(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return { ok: true, commit: result.commit?.sha };
}

export async function githubCreatePullRequest({ owner, repo, branch, title, body }) {
  assertConfigured();
  assertAllowed(owner, repo);

  const defaultBranch = await getDefaultBranch(owner, repo);
  const pr = await gh(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({ title, head: branch, base: defaultBranch, body }),
  });
  return { url: pr.html_url, number: pr.number };
}
