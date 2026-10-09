"use strict";

const { Timer, dateKey, weeklyMinutes, toCsv, validSession, validActiveSession } = FocusCore;
const byId = (id) => document.getElementById(id);
const storageKey = "focus-log.sessions.v1";
const activeStorageKey = "focus-log.active.v1";
let sessions = [];
let mode = "focus";
let startedAt = null;
let sessionId = null;
let sessionTask = "";
let sessionCategory = "";
let configuredMinutes = 25;
const timer = new Timer(configuredMinutes);

try {
  const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
  if (!Array.isArray(stored) || !stored.every(validSession)) throw new Error("Invalid records");
  sessions = stored;
} catch (error) {
  byId("message").textContent = "无法读取本地记录。新记录仍可导出，本次不会覆盖原数据；计时进度暂不保存。";
}

let storageAvailable = byId("message").textContent === "";
let activeStorageAvailable = storageAvailable;

function saveRecords() {
  if (!storageAvailable) return false;
  try {
    localStorage.setItem(storageKey, JSON.stringify(sessions));
    return true;
  } catch (error) {
    storageAvailable = false;
    byId("message").textContent = "浏览器无法保存记录。请在关闭页面前导出 CSV。";
    return false;
  }
}

function saveActiveTimer() {
  if (!activeStorageAvailable) return;
  try {
    if (!startedAt) {
      localStorage.removeItem(activeStorageKey);
    } else {
      localStorage.setItem(activeStorageKey, JSON.stringify({
        version: 1, id: sessionId, mode, task: sessionTask, category: sessionCategory,
        startedAt, minutes: configuredMinutes, timer: timer.snapshot()
      }));
    }
  } catch (error) {
    activeStorageAvailable = false;
    byId("message").textContent = "浏览器无法保存计时进度。刷新页面可能会中断这一轮。";
  }
}

function restoreActiveTimer() {
  if (!activeStorageAvailable) return;
  try {
    const raw = localStorage.getItem(activeStorageKey);
    if (!raw) return;
    const saved = JSON.parse(raw);
    const categories = Array.from(byId("category").options, (option) => option.value);
    if (!validActiveSession(saved) || !categories.includes(saved.category)) {
      throw new Error("Invalid saved session");
    }
    timer.restore(saved.timer);
    mode = saved.mode;
    startedAt = saved.startedAt;
    sessionId = saved.id;
    sessionTask = saved.task;
    sessionCategory = saved.category;
    configuredMinutes = saved.minutes;
    byId("task").value = sessionTask;
    byId("category").value = sessionCategory;
    byId("minutes").value = configuredMinutes;
    displayMode();
    setLocked(true);
    byId("start").textContent = timer.running ? "暂停" : "继续";
    byId("timer-state").textContent = timer.running ? "已恢复计时" : "已恢复暂停状态";
  } catch (error) {
    activeStorageAvailable = false;
    byId("message").textContent = "无法恢复上次计时。原状态未覆盖，这一轮的进度暂不保存。";
  }
}

function displayTime() {
  const seconds = Math.ceil(timer.remaining(Date.now()) / 1000);
  const text = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  byId("timer").textContent = text;
  document.title = startedAt ? `${text} · 专注小记` : "专注小记 · Focus Log";
}

function setLocked(locked) {
  for (const id of ["task", "category", "minutes", "focus-mode", "break-mode"]) {
    byId(id).disabled = locked;
  }
}

function drawRecords() {
  const now = new Date();
  const today = dateKey(now);
  const todaySessions = sessions.filter((session) => dateKey(new Date(session.finishedAt)) === today);
  const days = weeklyMinutes(sessions, now);
  byId("today-minutes").textContent = todaySessions.reduce((sum, session) => sum + session.minutes, 0);
  byId("today-count").textContent = todaySessions.length;
  byId("week-minutes").textContent = days.reduce((sum, day) => sum + day.minutes, 0);
  byId("export").disabled = sessions.length === 0;
  byId("empty").hidden = sessions.length > 0;
  byId("records-table").hidden = sessions.length === 0;

  const chart = byId("week-chart");
  chart.replaceChildren();
  const largest = Math.max(60, ...days.map((day) => day.minutes));
  for (const day of days) {
    const column = document.createElement("div");
    column.className = "chart-day";
    column.setAttribute("role", "listitem");
    column.setAttribute("aria-label", `${day.date}，${day.minutes} 分钟`);
    const value = document.createElement("span");
    value.className = "chart-value";
    value.textContent = day.minutes;
    const bar = document.createElement("div");
    bar.className = "chart-bar" + (day.date === today ? " today" : "");
    bar.style.height = `${Math.max(3, day.minutes / largest * 105)}px`;
    const label = document.createElement("span");
    label.className = "chart-label";
    label.textContent = day.date === today ? "今天" : day.date.slice(5).replace("-", "/");
    column.append(value, bar, label);
    chart.append(column);
  }

  const rows = byId("records");
  rows.replaceChildren();
  for (const session of sessions.slice().reverse()) {
    const row = document.createElement("tr");
    const time = new Date(session.finishedAt).toLocaleString("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
    });
    for (const value of [time, session.task, session.category, session.minutes]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    rows.append(row);
  }
}

function checkFinished() {
  const now = Date.now();
  const finishedAt = timer.deadline;
  if (!timer.tick(now)) return;
  let saved = mode === "break";
  if (mode === "focus") {
    // A saved session ID also prevents a repeat record if clearing the timer was interrupted.
    if (!sessions.some((session) => session.id === sessionId)) {
      sessions.push({
        id: sessionId, task: sessionTask, category: sessionCategory,
        startedAt, finishedAt: new Date(finishedAt).toISOString(), minutes: configuredMinutes
      });
    }
    saved = saveRecords();
    drawRecords();
    byId("timer-state").textContent = "这一轮完成了，休息一下吧";
  } else {
    byId("timer-state").textContent = "休息结束，准备下一轮";
  }
  byId("start").textContent = "再来一轮";
  setLocked(false);
  startedAt = null;
  sessionId = null;
  if (saved) saveActiveTimer();
}

function resetTimer() {
  timer.reset(configuredMinutes);
  startedAt = null;
  sessionId = null;
  byId("start").textContent = mode === "focus" ? "开始专注" : "开始休息";
  byId("timer-state").textContent = "准备好了就开始";
  setLocked(false);
  saveActiveTimer();
  displayTime();
}

byId("session-form").addEventListener("submit", (event) => event.preventDefault());
byId("start").addEventListener("click", () => {
  checkFinished();
  if (timer.running) {
    timer.pause(Date.now());
    byId("start").textContent = "继续";
    byId("timer-state").textContent = "已暂停，回来后继续";
  } else {
    const requested = Number(byId("minutes").value);
    if (!Number.isInteger(requested) || requested < 1 || requested > 120) {
      byId("message").textContent = "时长请填 1–120 之间的整数。";
      byId("minutes").focus();
      return;
    }
    if (!startedAt) {
      configuredMinutes = requested;
      timer.reset(configuredMinutes);
      const now = Date.now();
      startedAt = new Date(now).toISOString();
      sessionId = `${now}-${Math.random().toString(36).slice(2, 8)}`;
      sessionTask = byId("task").value.trim() || "未命名专注";
      sessionCategory = byId("category").value;
    }
    if (storageAvailable && activeStorageAvailable) byId("message").textContent = "";
    timer.start(Date.now());
    byId("start").textContent = "暂停";
    byId("timer-state").textContent = mode === "focus" ? "正在专注" : "休息中";
    setLocked(true);
  }
  saveActiveTimer();
  displayTime();
});

byId("reset").addEventListener("click", () => {
  checkFinished();
  resetTimer();
});
byId("minutes").addEventListener("change", () => {
  const minutes = Number(byId("minutes").value);
  if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 120) {
    configuredMinutes = minutes;
    resetTimer();
  }
});

function selectMode(nextMode) {
  mode = nextMode;
  configuredMinutes = mode === "focus" ? 25 : 5;
  byId("minutes").value = configuredMinutes;
  displayMode();
  resetTimer();
}

function displayMode() {
  for (const current of ["focus", "break"]) {
    byId(`${current}-mode`).classList.toggle("selected", mode === current);
    byId(`${current}-mode`).setAttribute("aria-pressed", mode === current);
  }
  byId("mode-caption").textContent = mode === "focus" ? "给这一轮定一个小目标" : "离开屏幕，活动一下";
}
byId("focus-mode").addEventListener("click", () => selectMode("focus"));
byId("break-mode").addEventListener("click", () => selectMode("break"));

byId("export").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([toCsv(sessions)], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `focus-log-${dateKey(new Date())}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

setInterval(() => {
  checkFinished();
  displayTime();
  if (dateKey(new Date()) !== lastDate) {
    lastDate = dateKey(new Date());
    drawRecords();
  }
}, 250);
document.addEventListener("visibilitychange", () => {
  checkFinished();
  displayTime();
});
let lastDate = dateKey(new Date());
drawRecords();
restoreActiveTimer();
checkFinished();
displayTime();
