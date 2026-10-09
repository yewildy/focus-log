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

  function weeklyMinutes(sessions, today) {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      date.setDate(date.getDate() - 6 + index);
      return { date: dateKey(date), minutes: 0 };
    });
    for (const session of sessions) {
      const day = days.find((item) => item.date === dateKey(new Date(session.finishedAt)));
      if (day) day.minutes += session.minutes;
    }
    return days;
  }

  function csvCell(value) {
    let text = String(value);
    // Keep task names from being treated as formulas when opened in a spreadsheet.
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function toCsv(sessions) {
    const lines = ["task,category,started_at,finished_at,duration_minutes"];
    for (const session of sessions) {
      lines.push([session.task, session.category, session.startedAt,
        session.finishedAt, session.minutes].map(csvCell).join(","));
    }
    return "\uFEFF" + lines.join("\r\n") + "\r\n";
  }

  function validSession(session) {
    return session && typeof session.id === "string" &&
      typeof session.task === "string" && session.task.length <= 100 &&
      typeof session.category === "string" &&
      Number.isInteger(session.minutes) && session.minutes >= 1 && session.minutes <= 120 &&
      Number.isFinite(Date.parse(session.startedAt)) &&
      Number.isFinite(Date.parse(session.finishedAt));
  }

  const api = { Timer, dateKey, weeklyMinutes, toCsv, validSession, validActiveSession };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FocusCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
