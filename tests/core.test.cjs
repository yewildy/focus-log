const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Timer, dateKey, weeklyMinutes, weeklyCategoryMinutes, toCsv, validActiveSession } = require("../core.js");

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
    { id: "sample-1", task: '日语,"表达"\n复习', category: "日语", startedAt: "2026-10-09T01:00:00Z", finishedAt: "2026-10-09T01:25:00Z", minutes: 25 },
    { id: "sample-2", task: '=HYPERLINK("https://example.com")', category: "+test", startedAt: "2026-10-09T02:00:00Z", finishedAt: "2026-10-09T02:01:00Z", minutes: 1 }
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

test("category totals share the chart's local-date window and include imported categories", () => {
  const today = new Date(2026, 9, 3, 12);
  const sessions = [
    { category: "日语", finishedAt: new Date(2026, 8, 27, 0).toISOString(), minutes: 25 },
    { category: "日语", finishedAt: new Date(2026, 9, 3, 23, 59).toISOString(), minutes: 15 },
    { category: "音乐 / 练琴", finishedAt: new Date(2026, 9, 1, 14).toISOString(), minutes: 30 },
    { category: "导入的阅读分类", finishedAt: new Date(2026, 9, 2, 14).toISOString(), minutes: 10 },
    { category: "范围外", finishedAt: new Date(2026, 8, 26, 23, 59).toISOString(), minutes: 120 },
    { category: "未来", finishedAt: new Date(2026, 9, 4, 0).toISOString(), minutes: 120 }
  ];
  const snapshot = JSON.stringify(sessions);
  const categories = weeklyCategoryMinutes(sessions, today);
  assert.deepEqual(categories, [
    { category: "日语", minutes: 40, sessions: 2 },
    { category: "音乐 / 练琴", minutes: 30, sessions: 1 },
    { category: "导入的阅读分类", minutes: 10, sessions: 1 }
  ]);
  assert.equal(categories.reduce((sum, item) => sum + item.minutes, 0),
    weeklyMinutes(sessions, today).reduce((sum, item) => sum + item.minutes, 0));
  assert.equal(JSON.stringify(sessions), snapshot);
});

test("category summary stays empty without records in its seven-day window", () => {
  const today = new Date(2026, 9, 12, 12);
  assert.deepEqual(weeklyCategoryMinutes([], today), []);
  assert.deepEqual(weeklyCategoryMinutes([
    { category: "旧记录", finishedAt: new Date(2026, 9, 5, 23, 59).toISOString(), minutes: 25 }
  ], today), []);
});

test("restoring a running timer keeps the original deadline", () => {
  const first = new Timer(1);
  first.start(1000);
  const restored = new Timer(25);
  restored.restore(JSON.parse(JSON.stringify(first.snapshot())));
  assert.equal(restored.remaining(21000), 40000);
  assert.equal(restored.tick(61000), true);
  assert.equal(restored.tick(62000), false);
});

test("a saved pause does not count time spent away from the page", () => {
  const first = new Timer(1);
  first.start(0);
  first.pause(20000);
  const restored = new Timer(25);
  restored.restore(first.snapshot());
  assert.equal(restored.remaining(900000), 40000);
  assert.equal(restored.tick(900000), false);
  restored.start(900000);
  assert.equal(restored.tick(940000), true);
});

test("invalid saved state is rejected without modifying a timer", () => {
  const timer = new Timer(25);
  for (const state of [null, {}, { durationMs: 60000, remainingMs: 60000, running: true, deadline: null },
    { durationMs: 60000, remainingMs: -1, running: false, deadline: null },
    { durationMs: 60000, remainingMs: 60001, running: false, deadline: null }]) {
    assert.throws(() => timer.restore(state), TypeError);
    assert.equal(timer.remaining(0), 1500000);
  }
});

test("active session metadata must match its saved duration and usable state", () => {
  const timer = new Timer(1);
  timer.start(1000);
  const active = { version: 1, id: "sample", mode: "focus", task: "日语", category: "日语",
    startedAt: "2026-10-10T00:00:00Z", minutes: 1, timer: timer.snapshot() };
  assert.equal(validActiveSession(active), true);
  assert.equal(validActiveSession({ ...active, minutes: 25 }), false);
  assert.equal(validActiveSession({ ...active, mode: "unknown" }), false);
  assert.equal(validActiveSession({ ...active, startedAt: "invalid" }), false);
  assert.equal(validActiveSession({ ...active, timer: { ...active.timer, running: false, deadline: null, remainingMs: 0 } }), false);
});
