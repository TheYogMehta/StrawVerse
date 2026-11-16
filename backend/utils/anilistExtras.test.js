// One escaped 429 used to fail the whole batch, and the caller caches null
// answers as "known" — so a rate-limit blip pinned missing status badges for
// the entire session. AniList 429s clear within seconds; verify one is
// retried instead of thrown.
const test = require("node:test");
const assert = require("node:assert");

test("fetchStatuses retries a 429 and answers from the second attempt", async () => {
  const { fetchStatuses } = require("./anilistExtras");
  let calls = 0;
  global.axios = {
    post: async () => {
      calls++;
      if (calls === 1) {
        const err = new Error("Request failed with status code 429");
        err.response = { status: 429, headers: {} };
        throw err;
      }
      // axios response shape: resp.data is the HTTP body = { data: {...} }
      return { data: { data: { m0: { status: "RELEASING" } } } };
    },
  };
  try {
    const out = await fetchStatuses([990001], "ANIME");
    assert.equal(calls, 2, "expected exactly one retry");
    assert.equal(out[990001], "RELEASING");
  } finally {
    delete global.axios;
  }
});

test("fetchStatuses still throws a persistent 429 after the retry budget", async () => {
  const { fetchStatuses } = require("./anilistExtras");
  let calls = 0;
  global.axios = {
    post: async () => {
      calls++;
      const err = new Error("Request failed with status code 429");
      err.response = { status: 429, headers: {} };
      throw err;
    },
  };
  try {
    await assert.rejects(() => fetchStatuses([990002], "ANIME"), /429/);
    assert.equal(calls, 3, "initial attempt plus two retries");
  } finally {
    delete global.axios;
  }
});
