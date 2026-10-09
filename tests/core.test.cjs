const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Timer, dateKey, weeklyMinutes, toCsv } = require("../core.js");

test("pause time is excluded and repeated starts do not extend the session", () => {
  const timer = new Timer(1);
  timer.start(1000);
  timer.start(10000);
  assert.equal(timer.remaining(21000), 40000);
  timer.pause(21000);
  assert.equal(timer.remaining(90000), 40000);
  timer.start(100000);
  assert.equal(timer.tick(139999), false);
  assert.equal(timer.tick(140000), true);
});

test("a delayed callback completes the timer once", () => {
  const timer = new Timer(25);
  timer.start(0);
  assert.equal(timer.tick(1600000), true);
  assert.equal(timer.remaining(1600001), 0);
  assert.equal(timer.tick(1700000), false);
});

test("resetting an unfinished timer creates no completion", () => {
  const timer = new Timer(1);
  timer.start(0);
  timer.reset(5);
  assert.equal(timer.tick(999999), false);
  assert.equal(timer.remaining(999999), 300000);
});

test("fractional, missing, and out-of-range durations are rejected", () => {
  for (const minutes of [0, -1, 121, 2.5, NaN, Infinity]) {
    assert.throws(() => new Timer(minutes), RangeError);
  }
});

test("CSV preserves Chinese, quotes, commas and line breaks and escapes formulas", () => {
  const csv = toCsv([
    { task: '日语,"表达"\n复习', category: "日语", startedAt: "2026-10-09T01:00:00Z", finishedAt: "2026-10-09T01:25:00Z", minutes: 25 },
    { task: '=HYPERLINK("https://example.com")', category: "+test", startedAt: "2026-10-09T02:00:00Z", finishedAt: "2026-10-09T02:01:00Z", minutes: 1 }
  ]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('"日语,""表达""\n复习"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.com"")"'));
  assert.ok(csv.includes('"\'+test"'));
  assert.ok(csv.endsWith("\r\n"));
});

test("the seven-day chart uses local completion dates across a month boundary", () => {
  const today = new Date(2026, 9, 3, 12);
  const sessions = [
    { finishedAt: new Date(2026, 8, 27, 23, 59).toISOString(), minutes: 25 },
    { finishedAt: new Date(2026, 9, 3, 0, 0).toISOString(), minutes: 15 },
    { finishedAt: new Date(2026, 8, 26, 23, 59).toISOString(), minutes: 99 }
  ];
  assert.equal(dateKey(today), "2026-10-03");
  const days = weeklyMinutes(sessions, today);
  assert.equal(days.length, 7);
  assert.deepEqual(days[0], { date: "2026-09-27", minutes: 25 });
  assert.deepEqual(days[6], { date: "2026-10-03", minutes: 15 });
  assert.equal(days.reduce((sum, day) => sum + day.minutes, 0), 40);
});
