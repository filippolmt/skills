const { execFileSync } = require('child_process');

// GITHUB_TOKEN lifts the anonymous rate limit (60 requests an hour, about two local
// runs of check-whole-sources.js). Locally, gh's own login stands in for it.
let token;
function githubToken() {
  if (token === undefined) {
    try {
      token = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      token = '';
    }
  }
  return token;
}

// GET a GitHub REST API path as JSON. A non-2xx status throws with the path, so
// callers exit 2 on it; an exhausted rate limit says so instead of a bare 403.
async function githubApi(apiPath) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (githubToken()) headers.Authorization = `Bearer ${githubToken()}`;
  const res = await fetch(`https://api.github.com/${apiPath}`, { headers });
  if (!res.ok) {
    const limited = (res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0';
    throw new Error(`${apiPath}: GitHub API ${res.status}${limited
      ? ' (rate limit exhausted: set GITHUB_TOKEN, or log in with `gh auth login`)' : ''}`);
  }
  return res.json();
}

module.exports = { githubApi };
