// GET a GitHub REST API path as JSON. GITHUB_TOKEN, when set, lifts the anonymous
// rate limit; a non-2xx status throws with the path, so callers exit 2 on it.
async function githubApi(apiPath) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/${apiPath}`, { headers });
  if (!res.ok) throw new Error(`${apiPath}: GitHub API ${res.status}`);
  return res.json();
}

module.exports = { githubApi };
