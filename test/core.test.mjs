import test from "node:test";
import assert from "node:assert/strict";

import { normalizeYouTube, parseTimestamps } from "../src/agent.mjs";
import { looseJson } from "../src/gemini.mjs";

test("normalizeYouTube converts youtu.be links and removes share parameters", () => {
  assert.equal(
    normalizeYouTube("https://youtu.be/abc123?si=tracking"),
    "https://www.youtube.com/watch?v=abc123",
  );
});

test("normalizeYouTube keeps a canonical watch URL", () => {
  assert.equal(
    normalizeYouTube("https://www.youtube.com/watch?v=abc123&si=tracking"),
    "https://www.youtube.com/watch?v=abc123",
  );
});

test("parseTimestamps parses, deduplicates, and caps timestamps", () => {
  assert.deepEqual(
    parseTimestamps("look at 6:01, 6:35, 1:23:45, again 6:01, and 9:59"),
    [361, 395, 5025],
  );
});

test("looseJson accepts fenced JSON output", () => {
  assert.deepEqual(
    looseJson("```json\n{\"name\":\"ナマエ\",\"ok\":true}\n```"),
    { name: "ナマエ", ok: true },
  );
});

test("looseJson extracts a JSON value from surrounding model text", () => {
  assert.deepEqual(
    looseJson("Here is the result: [1, 2, 3] Thanks."),
    [1, 2, 3],
  );
});
