// Self-check for github.js: the rate-limit message and the token header, with fetch stubbed.
const { test } = require('node:test');
const assert = require('node:assert');

process.env.GITHUB_TOKEN = 'tok';
const { githubApi } = require('./github.js');

const respond = (status, remaining) => async (url, { headers }) => ({
  ok: status === 200, status, headers: new Map([['x-ratelimit-remaining', remaining]]),
  json: async () => ({ url, auth: headers.Authorization }),
});

test('sends the token and returns the JSON body', async () => {
  global.fetch = respond(200, '59');
  assert.deepEqual(await githubApi('repos/a/b'), { url: 'https://api.github.com/repos/a/b', auth: 'Bearer tok' });
});

test('an exhausted rate limit says so; another 403 stays bare', async () => {
  global.fetch = respond(403, '0');
  await assert.rejects(githubApi('x'), /x: GitHub API 403 \(rate limit exhausted/);
  global.fetch = respond(403, '12');
  await assert.rejects(githubApi('x'), /^Error: x: GitHub API 403$/);
});
