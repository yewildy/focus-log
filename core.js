(function (root) {
  "use strict";

  class Timer {
    constructor(minutes) {
      this.reset(minutes);
    }

    reset(minutes) {
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
        throw new RangeError("Choose a whole number between 1 and 120 minutes.");
      }
      this.durationMs = minutes * 60 * 1000;
      this.remainingMs = this.durationMs;
      this.deadline = null;
      this.running = false;
    }

    start(now) {
      if (this.running || this.remainingMs === 0) return;
      this.deadline = now + this.remainingMs;
      this.running = true;
    }

    remaining(now) {
      return this.running ? Math.max(0, this.deadline - now) : this.remainingMs;
    }

    pause(now) {
      this.remainingMs = this.remaining(now);
      this.running = false;
      this.deadline = null;
    }

    tick(now) {
      if (!this.running || this.remaining(now) > 0) return false;
      this.pause(now);
      return true;
    }

    snapshot() {
      return { durationMs: this.durationMs, remainingMs: this.remainingMs,
        deadline: this.deadline, running: this.running };
    }

    restore(state) {
      if (!validTimerState(state)) throw new TypeError("Invalid saved timer.");
      this.durationMs = state.durationMs;
      this.remainingMs = state.remainingMs;
      this.deadline = state.deadline;
      this.running = state.running;
    }
  }

  function validTimerState(state) {
    return state && Number.isInteger(state.durationMs) &&
      state.durationMs >= 60000 && state.durationMs <= 7200000 &&
      state.durationMs % 60000 === 0 && Number.isFinite(state.remainingMs) &&
      state.remainingMs >= 0 && state.remainingMs <= state.durationMs &&
      typeof state.running === "boolean" &&
      (state.running ? Number.isFinite(state.deadline) : state.deadline === null);
  }

  function validActiveSession(session) {
    return session && session.version === 1 &&
      typeof session.id === "string" && session.id.length > 0 &&
      ["focus", "break"].includes(session.mode) &&
      typeof session.task === "string" && session.task.length <= 100 &&
      typeof session.category === "string" &&
      typeof session.startedAt === "string" && Number.isFinite(Date.parse(session.startedAt)) &&
      Number.isInteger(session.minutes) && validTimerState(session.timer) &&
      session.minutes * 60000 === session.timer.durationMs &&
      (session.timer.running || session.timer.remainingMs > 0);
  }

  function dateKey(date) {
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function weekDateKeys(today) {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      date.setDate(date.getDate() - 6 + index);
      return dateKey(date);
    });
  }

  function weeklyMinutes(sessions, today) {
    const days = weekDateKeys(today).map((date) => ({ date, minutes: 0 }));
    for (const session of sessions) {
      const day = days.find((item) => item.date === dateKey(new Date(session.finishedAt)));
      if (day) day.minutes += session.minutes;
    }
    return days;
  }

  function weeklyCategoryMinutes(sessions, today) {
    const dates = new Set(weekDateKeys(today));
    const categories = new Map();
    for (const session of sessions) {
      if (!dates.has(dateKey(new Date(session.finishedAt)))) continue;
      if (!categories.has(session.category)) {
        categories.set(session.category, { category: session.category, minutes: 0, sessions: 0 });
      }
      const category = categories.get(session.category);
      category.minutes += session.minutes;
      category.sessions++;
    }
    return Array.from(categories.values()).sort((left, right) =>
      right.minutes - left.minutes || left.category.localeCompare(right.category, "zh-CN"));
  }

  function needsCsvEscape(value) {
    return /^[\s]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value);
  }

  function csvCell(value) {
    let text = String(value);
    // Keep text from being treated as a formula when opened in a spreadsheet.
    if (needsCsvEscape(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function toCsv(sessions) {
    const lines = ["task,category,started_at,finished_at,duration_minutes,id,escaped_fields"];
    for (const session of sessions) {
      const escaped = ["task", "category", "id"].filter((field) => needsCsvEscape(session[field]));
      lines.push([session.task, session.category, session.startedAt,
        session.finishedAt, session.minutes, session.id, escaped.join("|")].map(csvCell).join(","));
    }
    return "\uFEFF" + lines.join("\r\n") + "\r\n";
  }

  function parseCsvRows(text) {
    if (typeof text !== "string" || text.length > 2 * 1024 * 1024) {
      throw new Error("CSV 文件不能超过 2 MB。");
    }
    text = text.replace(/^\uFEFF/, "");
    const rows = [];
    let row = [], field = "", quoted = false, closedQuote = false;
    const finishField = () => {
      row.push(field);
      field = "";
      closedQuote = false;
    };
    const finishRow = () => {
      finishField();
      if (!(row.length === 1 && row[0].trim() === "")) rows.push(row);
      if (rows.length > 10001) throw new Error("一次最多导入 10000 条记录。");
      row = [];
    };
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (quoted) {
        if (character === '"') {
          if (text[index + 1] === '"') { field += '"'; index++; }
          else { quoted = false; closedQuote = true; }
        } else field += character;
      } else if (character === ",") finishField();
      else if (character === "\r" || character === "\n") {
        finishRow();
        if (character === "\r" && text[index + 1] === "\n") index++;
      } else if (closedQuote) throw new Error("CSV 引号后应为逗号或换行。");
      else if (character === '"') {
        if (field !== "") throw new Error("CSV 字段中的引号需要成对转义。");
        quoted = true;
      } else field += character;
    }
    if (quoted) throw new Error("CSV 中有未闭合的引号。");
    if (row.length || field !== "" || closedQuote) finishRow();
    return rows;
  }

  function timestamp(value) {
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!parts) return NaN;
    const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
        hour > 23 || minute > 59 || second > 59) return NaN;
    return Date.parse(value);
  }

  function sessionKey(session) {
    return JSON.stringify([session.task, session.category,
      new Date(session.startedAt).toISOString(), new Date(session.finishedAt).toISOString(), session.minutes]);
  }

  function fromCsv(text) {
    const rows = parseCsvRows(text);
    const oldColumns = ["task", "category", "started_at", "finished_at", "duration_minutes"];
    const columns = rows.shift()?.map((column) => column.trim()) || [];
    const legacy = columns.length === oldColumns.length;
    const expected = legacy ? oldColumns : [...oldColumns, "id", "escaped_fields"];
    if (columns.length !== expected.length || new Set(columns).size !== columns.length ||
        !expected.every((column) => columns.includes(column))) {
      throw new Error("CSV 表头不符合专注小记的导出格式，请保留原表头。");
    }
    return rows.map((row, index) => {
      const invalid = (reason) => { throw new Error(`第 ${index + 1} 条记录：${reason}`); };
      if (row.length !== columns.length) invalid("列数与表头不一致。");
      const record = Object.fromEntries(columns.map((column, columnIndex) => [column, row[columnIndex]]));
      if (!legacy) {
        const escaped = record.escaped_fields ? record.escaped_fields.split("|") : [];
        if (new Set(escaped).size !== escaped.length) invalid("转义标记重复。");
        for (const field of escaped) {
          if (!["task", "category", "id"].includes(field) ||
              !record[field].startsWith("'") || !needsCsvEscape(record[field].slice(1))) {
            invalid("转义标记与字段不匹配。");
          }
          record[field] = record[field].slice(1);
        }
      }
      if (record.task.length > 100 || !record.category.trim() || record.category.length > 60) {
        invalid("目标最多 100 字，分类需为 1–60 字。");
      }
      const minutes = Number(record.duration_minutes);
      if (!/^\d+$/.test(record.duration_minutes.trim()) || !Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
        invalid("分钟数需为 1–120 之间的整数。");
      }
      const start = timestamp(record.started_at), finish = timestamp(record.finished_at);
      if (!Number.isFinite(start) || !Number.isFinite(finish) || finish - start < minutes * 60000) {
        invalid("起止时间需为含时区的 ISO 时间，且间隔不能小于专注时长。");
      }
      const session = { task: record.task, category: record.category, minutes,
        startedAt: new Date(start).toISOString(), finishedAt: new Date(finish).toISOString() };
      session.id = legacy ? "legacy:" + sessionKey(session) : record.id;
      if (!session.id || session.id.length > 512) invalid("记录 ID 为空或过长。");
      return session;
    });
  }

  function mergeSessions(existing, incoming) {
    const merged = existing.slice();
    const ids = new Set(existing.map((session) => session.id));
    const keys = new Set(existing.map(sessionKey));
    const legacyKeys = new Set();
    const rememberLegacy = (session) => legacyKeys.add(sessionKey({ ...session,
      task: needsCsvEscape(session.task) ? "'" + session.task : session.task,
      category: needsCsvEscape(session.category) ? "'" + session.category : session.category }));
    existing.forEach(rememberLegacy);
    let duplicates = 0;
    for (const session of incoming) {
      const key = sessionKey(session);
      if (ids.has(session.id) || keys.has(key) || (session.id.startsWith("legacy:") && legacyKeys.has(key))) {
        duplicates++;
        continue;
      }
      merged.push(session);
      ids.add(session.id);
      keys.add(key);
      rememberLegacy(session);
    }
    merged.sort((left, right) => Date.parse(left.finishedAt) - Date.parse(right.finishedAt));
    return { sessions: merged, added: incoming.length - duplicates, duplicates };
  }

  function validSession(session) {
    return session && typeof session.id === "string" &&
      typeof session.task === "string" && session.task.length <= 100 &&
      typeof session.category === "string" &&
      Number.isInteger(session.minutes) && session.minutes >= 1 && session.minutes <= 120 &&
      Number.isFinite(Date.parse(session.startedAt)) &&
      Number.isFinite(Date.parse(session.finishedAt));
  }

  const api = { Timer, dateKey, weeklyMinutes, weeklyCategoryMinutes, toCsv, fromCsv, mergeSessions, validSession, validActiveSession };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FocusCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
