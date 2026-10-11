const { test } = require("node:test");
const assert = require("node:assert/strict");
const { toCsv, fromCsv, mergeSessions } = require("../core.js");

const sample = (overrides = {}) => ({
  id: "sample-1", task: "日语表达复习", category: "日语", minutes: 25,
  startedAt: "2026-10-11T03:00:00.000Z", finishedAt: "2026-10-11T03:25:00.000Z", ...overrides
});
const oldHeader = "task,category,started_at,finished_at,duration_minutes";

test("exported backups restore IDs, Chinese, commas, quotes, line breaks, and literal apostrophes", () => {
  const records = [sample({ task: '复习,"例句"\n第二行' }),
    sample({ id: "sample-2", task: "'=保留这个单引号", category: "音乐 / 练琴" })];
  assert.deepEqual(fromCsv(toCsv(records)), records);
});

test("spreadsheet protection is reversible for task, category, and ID", () => {
  const record = sample({ id: "+sample", task: '=HYPERLINK("https://example.com")', category: "\t练琴" });
  const csv = toCsv([record]);
  assert.ok(csv.includes('"task|category|id"'));
  assert.deepEqual(fromCsv(csv), [record]);
});

test("legacy five-column exports remain readable and do not duplicate native records", () => {
  const record = sample({ task: "=一个文字目标" });
  const csv = oldHeader + '\r\n"\'=一个文字目标",日语,2026-10-11T03:00:00Z,2026-10-11T03:25:00Z,25\r\n';
  const imported = fromCsv(csv);
  assert.equal(imported[0].task, "'=一个文字目标");
  const result = mergeSessions([record], imported);
  assert.equal(result.added, 0);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.sessions, [record]);
});

test("duplicate detection works within a backup, across backups, and with equivalent time zones", () => {
  const existing = sample();
  const same = sample({ id: "different-id", startedAt: "2026-10-11T12:00:00+09:00", finishedAt: "2026-10-11T12:25:00+09:00" });
  const newRecord = sample({ id: "new-session", task: "电路复习", category: "电路 / 编程" });
  const result = mergeSessions([existing], fromCsv(toCsv([same, newRecord, newRecord])));
  assert.equal(result.added, 1);
  assert.equal(result.duplicates, 2);
  assert.equal(mergeSessions(result.sessions, fromCsv(toCsv([newRecord]))).added, 0);
});

test("an existing ID is never replaced by edited backup content", () => {
  const existing = sample();
  const result = mergeSessions([existing], [sample({ task: "另一份备份里的改动" })]);
  assert.deepEqual(result.sessions, [existing]);
  assert.equal(result.duplicates, 1);
});

test("invalid rows reject the complete import, including bad dates, short intervals, and fractional durations", () => {
  for (const row of [
    "任务,日语,2026-02-31T03:00:00Z,2026-03-01T03:25:00Z,25",
    "任务,日语,2026-10-11T03:00:00Z,2026-10-11T03:01:00Z,25",
    "任务,日语,2026-10-11T03:00:00Z,2026-10-11T03:25:00Z,1.5",
    "任务,日语,2026-10-11 03:00:00,2026-10-11 03:25:00,25",
    "任务,,2026-10-11T03:00:00Z,2026-10-11T03:25:00Z,25"
  ]) {
    const csv = oldHeader + "\n有效任务,日语,2026-10-11T03:00:00Z,2026-10-11T03:25:00Z,25\n" + row;
    assert.throws(() => fromCsv(csv), /第 2 条记录/);
  }
});

test("malformed quotes, columns, escape metadata, and oversized files are rejected", () => {
  assert.throws(() => fromCsv(oldHeader + '\n"未闭合'), /未闭合/);
  assert.throws(() => fromCsv(oldHeader + '\n"目标"x,日语,2026-10-11T03:00:00Z,2026-10-11T03:25:00Z,25'), /引号后/);
  assert.throws(() => fromCsv(oldHeader + "\n目标,日语"), /列数/);
  assert.throws(() => fromCsv("task,task,started_at,finished_at,duration_minutes"), /表头/);
  const badMarker = toCsv([sample()]).replace('"sample-1",""', '"sample-1","task"');
  assert.throws(() => fromCsv(badMarker), /转义标记/);
  assert.throws(() => fromCsv("x".repeat(2 * 1024 * 1024 + 1)), /2 MB/);
});

test("blank lines and reordered headers are accepted; header-only backups contain no records", () => {
  assert.deepEqual(fromCsv(oldHeader + "\r\n"), []);
  const csv = '\uFEFFcategory,task,duration_minutes,finished_at,started_at\r\n\r\n日语,"中文,目标",25,2026-10-11T03:25:00Z,2026-10-11T03:00:00Z\r\n';
  const records = fromCsv(csv);
  assert.equal(records.length, 1);
  assert.equal(records[0].task, "中文,目标");
});
