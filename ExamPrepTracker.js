// ExamPrepTracker.jsx
import React, { useState, useEffect, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var STORAGE_KEY = "examPrepData_v1";
var defaultData = {
  schedule: {},
  // { '2026-06-13': [ {id, subject, topic, start, end, notes, status, actualSeconds} ] }
  logs: {},
  // { '2026-06-13': { distractions: [], reflection: '' } }
  examDate: "",
  examName: "",
  quizBank: []
  // { id, subject, question, options[4], correctIndex }
};
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData;
    return { ...defaultData, ...JSON.parse(raw) };
  } catch {
    return defaultData;
  }
}
function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Save failed", e);
  }
}
function todayKey(offset = 0) {
  const d = /* @__PURE__ */ new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().split("T")[0];
}
function formatDateLabel(key) {
  const d = /* @__PURE__ */ new Date(key + "T00:00:00");
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function formatSeconds(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor(s % 3600 / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
function genId() {
  return Math.random().toString(36).slice(2, 10);
}
function App() {
  const [data, setData] = useState(loadData);
  const [tab, setTab] = useState("today");
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [activeTimer, setActiveTimer] = useState(null);
  const [tick, setTick] = useState(0);
  const [showQuizPrompt, setShowQuizPrompt] = useState(null);
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const intervalRef = useRef(null);
  useEffect(() => {
    saveData(data);
  }, [data]);
  useEffect(() => {
    if (activeTimer) {
      intervalRef.current = setInterval(() => setTick((t) => t + 1), 1e3);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [activeTimer]);
  useEffect(() => {
    const check = () => {
      if (notifPermission !== "granted") return;
      const now = /* @__PURE__ */ new Date();
      const key = todayKey();
      const tasks = data.schedule[key] || [];
      tasks.forEach((t) => {
        const [sh, sm] = t.start.split(":").map(Number);
        const startMins = sh * 60 + sm;
        const nowMins = now.getHours() * 60 + now.getMinutes();
        if (nowMins === startMins && t.status === "pending" && !t._notifiedStart) {
          new Notification("Study time!", { body: `${t.subject}: ${t.topic}` });
          markNotified(key, t.id, "_notifiedStart");
        }
        const [eh, em] = t.end.split(":").map(Number);
        const endMins = eh * 60 + em;
        if (nowMins === endMins + 15 && t.status !== "completed" && !t._notifiedFollowup) {
          new Notification("Still on track?", { body: `Mark "${t.topic}" done or update its status.` });
          markNotified(key, t.id, "_notifiedFollowup");
        }
      });
    };
    const id = setInterval(check, 3e4);
    return () => clearInterval(id);
  }, [data, notifPermission]);
  function markNotified(dateKey, taskId, field) {
    setData((d) => {
      const tasks = (d.schedule[dateKey] || []).map(
        (t) => t.id === taskId ? { ...t, [field]: true } : t
      );
      return { ...d, schedule: { ...d.schedule, [dateKey]: tasks } };
    });
  }
  function requestNotifications() {
    if (typeof Notification === "undefined") return;
    Notification.requestPermission().then(setNotifPermission);
  }
  function addTask(dateKey, task) {
    setData((d) => {
      const existing = d.schedule[dateKey] || [];
      const newTask = { id: genId(), status: "pending", actualSeconds: 0, ...task };
      const updated = [...existing, newTask].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
      return { ...d, schedule: { ...d.schedule, [dateKey]: updated } };
    });
  }
  function updateTask(dateKey, taskId, updates) {
    setData((d) => {
      const tasks = (d.schedule[dateKey] || []).map((t) => t.id === taskId ? { ...t, ...updates } : t);
      return { ...d, schedule: { ...d.schedule, [dateKey]: tasks } };
    });
  }
  function deleteTask(dateKey, taskId) {
    setData((d) => {
      const tasks = (d.schedule[dateKey] || []).filter((t) => t.id !== taskId);
      return { ...d, schedule: { ...d.schedule, [dateKey]: tasks } };
    });
  }
  function toggleTimer(dateKey, task) {
    if (activeTimer === task.id) {
      setActiveTimer(null);
    } else {
      if (activeTimer) {
        setActiveTimer(null);
      }
      updateTask(dateKey, task.id, { status: "in_progress", _timerStart: Date.now() });
      setActiveTimer(task.id);
    }
  }
  function markComplete(dateKey, task) {
    let extraSeconds = 0;
    if (activeTimer === task.id && task._timerStart) {
      extraSeconds = Math.floor((Date.now() - task._timerStart) / 1e3);
      setActiveTimer(null);
    }
    updateTask(dateKey, task.id, {
      status: "completed",
      actualSeconds: (task.actualSeconds || 0) + extraSeconds,
      _timerStart: null
    });
    setShowQuizPrompt(task);
  }
  function markSkipped(dateKey, task) {
    if (activeTimer === task.id) setActiveTimer(null);
    updateTask(dateKey, task.id, { status: "skipped", _timerStart: null });
  }
  function getElapsedSeconds(task) {
    let base = task.actualSeconds || 0;
    if (activeTimer === task.id && task._timerStart) {
      base += Math.floor((Date.now() - task._timerStart) / 1e3);
    }
    return base;
  }
  return /* @__PURE__ */ jsxs("div", { style: styles.app, children: [
    /* @__PURE__ */ jsx(Header, { data, setData, notifPermission, requestNotifications }),
    /* @__PURE__ */ jsxs("div", { style: styles.content, children: [
      tab === "today" && /* @__PURE__ */ jsx(
        TodayView,
        {
          data,
          dateKey: todayKey(),
          addTask,
          updateTask,
          deleteTask,
          toggleTimer,
          markComplete,
          markSkipped,
          activeTimer,
          getElapsedSeconds,
          setData
        }
      ),
      tab === "schedule" && /* @__PURE__ */ jsx(
        ScheduleView,
        {
          data,
          addTask,
          deleteTask,
          selectedDate,
          setSelectedDate
        }
      ),
      tab === "progress" && /* @__PURE__ */ jsx(ProgressView, { data }),
      tab === "quiz" && /* @__PURE__ */ jsx(QuizView, { data, setData }),
      tab === "settings" && /* @__PURE__ */ jsx(SettingsView, { data, setData })
    ] }),
    showQuizPrompt && /* @__PURE__ */ jsx(
      QuizReminderModal,
      {
        task: showQuizPrompt,
        onClose: () => setShowQuizPrompt(null),
        onGoToQuiz: () => {
          setShowQuizPrompt(null);
          setTab("quiz");
        }
      }
    ),
    /* @__PURE__ */ jsx(BottomNav, { tab, setTab })
  ] });
}
function Header({ data, notifPermission, requestNotifications }) {
  const daysLeft = data.examDate ? Math.ceil((new Date(data.examDate) - new Date(todayKey())) / (1e3 * 60 * 60 * 24)) : null;
  return /* @__PURE__ */ jsxs("div", { style: styles.header, children: [
    /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("p", { style: styles.appName, children: "Prep Tracker" }),
      data.examName && /* @__PURE__ */ jsx("p", { style: styles.examLabel, children: data.examName })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12 }, children: [
      daysLeft !== null && /* @__PURE__ */ jsxs("div", { style: styles.countdownBadge, children: [
        /* @__PURE__ */ jsx("span", { style: styles.countdownNum, children: daysLeft >= 0 ? daysLeft : 0 }),
        /* @__PURE__ */ jsx("span", { style: styles.countdownLabel, children: "days left" })
      ] }),
      notifPermission !== "granted" && /* @__PURE__ */ jsx("button", { onClick: requestNotifications, style: styles.bellBtn, "aria-label": "Enable notifications", children: /* @__PURE__ */ jsx("i", { className: "ti ti-bell", style: { fontSize: 18 } }) })
    ] })
  ] });
}
function TodayView({ data, dateKey, addTask, updateTask, deleteTask, toggleTimer, markComplete, markSkipped, activeTimer, getElapsedSeconds, setData }) {
  const tasks = data.schedule[dateKey] || [];
  const [showAdd, setShowAdd] = useState(false);
  const [reflection, setReflection] = useState(data.logs[dateKey]?.reflection || "");
  const [distractionInput, setDistractionInput] = useState("");
  const completed = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round(completed / total * 100) : 0;
  function logDistraction() {
    if (!distractionInput.trim()) return;
    setData((d) => {
      const log2 = d.logs[dateKey] || { distractions: [], reflection: "" };
      const newLog = { ...log2, distractions: [...log2.distractions, { text: distractionInput, time: (/* @__PURE__ */ new Date()).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) }] };
      return { ...d, logs: { ...d.logs, [dateKey]: newLog } };
    });
    setDistractionInput("");
  }
  function saveReflection() {
    setData((d) => {
      const log2 = d.logs[dateKey] || { distractions: [], reflection: "" };
      return { ...d, logs: { ...d.logs, [dateKey]: { ...log2, reflection } } };
    });
  }
  const log = data.logs[dateKey] || { distractions: [], reflection: "" };
  if (total === 0) {
    return /* @__PURE__ */ jsxs("div", { style: styles.section, children: [
      /* @__PURE__ */ jsx("div", { style: styles.dateLabel, children: formatDateLabel(dateKey) }),
      /* @__PURE__ */ jsx(
        EmptyState,
        {
          icon: "ti-calendar-plus",
          title: "Nothing planned for today",
          body: "Add today's schedule, or plan your whole week from the Schedule tab.",
          actionLabel: "Add a task",
          onAction: () => setShowAdd(true)
        }
      ),
      showAdd && /* @__PURE__ */ jsx(AddTaskForm, { dateKey, addTask, onDone: () => setShowAdd(false) })
    ] });
  }
  return /* @__PURE__ */ jsxs("div", { style: styles.section, children: [
    /* @__PURE__ */ jsx("div", { style: styles.dateLabel, children: formatDateLabel(dateKey) }),
    /* @__PURE__ */ jsx("div", { style: styles.progressBarOuter, children: /* @__PURE__ */ jsx("div", { style: { ...styles.progressBarInner, width: `${pct}%` } }) }),
    /* @__PURE__ */ jsxs("p", { style: styles.progressText, children: [
      completed,
      " of ",
      total,
      " done \xB7 ",
      pct,
      "%"
    ] }),
    /* @__PURE__ */ jsx("div", { style: { marginTop: "1rem" }, children: tasks.map((t) => /* @__PURE__ */ jsx(
      TaskCard,
      {
        task: t,
        dateKey,
        toggleTimer,
        markComplete,
        markSkipped,
        activeTimer,
        elapsed: getElapsedSeconds(t),
        deleteTask,
        updateTask
      },
      t.id
    )) }),
    !showAdd ? /* @__PURE__ */ jsxs("button", { style: styles.addBtn, onClick: () => setShowAdd(true), children: [
      /* @__PURE__ */ jsx("i", { className: "ti ti-plus", style: { fontSize: 16, marginRight: 6 } }),
      "Add task"
    ] }) : /* @__PURE__ */ jsx(AddTaskForm, { dateKey, addTask, onDone: () => setShowAdd(false) }),
    /* @__PURE__ */ jsxs("div", { style: styles.card, children: [
      /* @__PURE__ */ jsxs("p", { style: styles.cardTitle, children: [
        /* @__PURE__ */ jsx("i", { className: "ti ti-bolt", style: { fontSize: 16, marginRight: 6 }, "aria-hidden": "true" }),
        "Distraction log"
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8 }, children: [
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "text",
            placeholder: "What pulled you away?",
            value: distractionInput,
            onChange: (e) => setDistractionInput(e.target.value),
            onKeyDown: (e) => e.key === "Enter" && logDistraction(),
            style: { flex: 1 }
          }
        ),
        /* @__PURE__ */ jsx("button", { onClick: logDistraction, style: { width: 60 }, children: "Log" })
      ] }),
      log.distractions.length > 0 && /* @__PURE__ */ jsx("ul", { style: styles.distractionList, children: log.distractions.map((d, i) => /* @__PURE__ */ jsxs("li", { style: styles.distractionItem, children: [
        /* @__PURE__ */ jsx("span", { style: { color: "var(--color-text-tertiary)", marginRight: 8 }, children: d.time }),
        d.text
      ] }, i)) })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: styles.card, children: [
      /* @__PURE__ */ jsxs("p", { style: styles.cardTitle, children: [
        /* @__PURE__ */ jsx("i", { className: "ti ti-note", style: { fontSize: 16, marginRight: 6 }, "aria-hidden": "true" }),
        "Today's reflection"
      ] }),
      /* @__PURE__ */ jsx(
        "textarea",
        {
          placeholder: "What went wrong today? What will you change tomorrow?",
          value: reflection,
          onChange: (e) => setReflection(e.target.value),
          onBlur: saveReflection,
          rows: 3,
          style: { width: "100%", resize: "vertical" }
        }
      )
    ] })
  ] });
}
var statusColors = {
  pending: "c-gray",
  in_progress: "c-blue",
  completed: "c-teal",
  skipped: "c-coral"
};
var statusLabels = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  skipped: "Skipped"
};
function TaskCard({ task, dateKey, toggleTimer, markComplete, markSkipped, activeTimer, elapsed, deleteTask, updateTask }) {
  const planned = (timeToMinutes(task.end) - timeToMinutes(task.start)) * 60;
  const isRunning = activeTimer === task.id;
  return /* @__PURE__ */ jsxs("div", { style: { ...styles.taskCard, opacity: task.status === "skipped" ? 0.6 : 1 }, children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" }, children: [
      /* @__PURE__ */ jsxs("div", { style: { flex: 1 }, children: [
        /* @__PURE__ */ jsxs("p", { style: styles.taskTime, children: [
          task.start,
          " \u2013 ",
          task.end
        ] }),
        /* @__PURE__ */ jsx("p", { style: styles.taskSubject, children: task.subject }),
        /* @__PURE__ */ jsx("p", { style: styles.taskTopic, children: task.topic }),
        task.notes && /* @__PURE__ */ jsx("p", { style: styles.taskNotes, children: task.notes })
      ] }),
      /* @__PURE__ */ jsx("span", { className: statusColors[task.status], style: styles.statusBadge, children: statusLabels[task.status] })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: styles.taskFooter, children: [
      /* @__PURE__ */ jsxs("span", { style: styles.timeSpent, children: [
        /* @__PURE__ */ jsx("i", { className: "ti ti-clock", style: { fontSize: 14, marginRight: 4, verticalAlign: -2 }, "aria-hidden": "true" }),
        formatSeconds(elapsed),
        " / ",
        formatSeconds(planned)
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8 }, children: [
        task.status !== "completed" && task.status !== "skipped" && /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx("button", { onClick: () => toggleTimer(dateKey, task), style: styles.iconBtn, "aria-label": isRunning ? "Pause timer" : "Start timer", children: /* @__PURE__ */ jsx("i", { className: isRunning ? "ti ti-player-pause" : "ti ti-player-play", style: { fontSize: 16 }, "aria-hidden": "true" }) }),
          /* @__PURE__ */ jsx("button", { onClick: () => markComplete(dateKey, task), style: styles.iconBtn, "aria-label": "Mark complete", children: /* @__PURE__ */ jsx("i", { className: "ti ti-check", style: { fontSize: 16 }, "aria-hidden": "true" }) }),
          /* @__PURE__ */ jsx("button", { onClick: () => markSkipped(dateKey, task), style: styles.iconBtn, "aria-label": "Skip task", children: /* @__PURE__ */ jsx("i", { className: "ti ti-x", style: { fontSize: 16 }, "aria-hidden": "true" }) })
        ] }),
        /* @__PURE__ */ jsx("button", { onClick: () => deleteTask(dateKey, task.id), style: styles.iconBtn, "aria-label": "Delete task", children: /* @__PURE__ */ jsx("i", { className: "ti ti-trash", style: { fontSize: 16 }, "aria-hidden": "true" }) })
      ] })
    ] })
  ] });
}
function AddTaskForm({ dateKey, addTask, onDone }) {
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [notes, setNotes] = useState("");
  function submit() {
    if (!subject.trim() || !topic.trim()) return;
    addTask(dateKey, { subject, topic, start, end, notes });
    setSubject("");
    setTopic("");
    setNotes("");
    onDone();
  }
  return /* @__PURE__ */ jsxs("div", { style: styles.card, children: [
    /* @__PURE__ */ jsx("p", { style: styles.cardTitle, children: "New task" }),
    /* @__PURE__ */ jsxs("div", { style: styles.formGrid, children: [
      /* @__PURE__ */ jsx("input", { placeholder: "Subject (e.g. History)", value: subject, onChange: (e) => setSubject(e.target.value) }),
      /* @__PURE__ */ jsx("input", { placeholder: "Topic (e.g. Mughal administration)", value: topic, onChange: (e) => setTopic(e.target.value) }),
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8 }, children: [
        /* @__PURE__ */ jsx("input", { type: "time", value: start, onChange: (e) => setStart(e.target.value), style: { flex: 1 } }),
        /* @__PURE__ */ jsx("input", { type: "time", value: end, onChange: (e) => setEnd(e.target.value), style: { flex: 1 } })
      ] }),
      /* @__PURE__ */ jsx("textarea", { placeholder: "Notes (optional)", value: notes, onChange: (e) => setNotes(e.target.value), rows: 2 })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, marginTop: 12 }, children: [
      /* @__PURE__ */ jsx("button", { onClick: submit, style: { flex: 1 }, children: "Add" }),
      /* @__PURE__ */ jsx("button", { onClick: onDone, style: { flex: 1 }, children: "Cancel" })
    ] })
  ] });
}
function ScheduleView({ data, addTask, deleteTask, selectedDate, setSelectedDate }) {
  const [showAdd, setShowAdd] = useState(false);
  const [weekMode, setWeekMode] = useState(false);
  const dateOptions = Array.from({ length: 8 }, (_, i) => todayKey(i));
  const tasks = data.schedule[selectedDate] || [];
  return /* @__PURE__ */ jsxs("div", { style: styles.section, children: [
    /* @__PURE__ */ jsx("p", { style: styles.sectionTitle, children: "Plan ahead" }),
    /* @__PURE__ */ jsx("div", { style: styles.dateChips, children: dateOptions.map((dk, i) => /* @__PURE__ */ jsx(
      "button",
      {
        onClick: () => setSelectedDate(dk),
        style: {
          ...styles.dateChip,
          ...selectedDate === dk ? styles.dateChipActive : {}
        },
        children: i === 0 ? "Today" : formatDateLabel(dk).split(",")[0]
      },
      dk
    )) }),
    /* @__PURE__ */ jsx("p", { style: styles.dateLabel, children: formatDateLabel(selectedDate) }),
    tasks.length === 0 && /* @__PURE__ */ jsx(
      EmptyState,
      {
        icon: "ti-calendar-event",
        title: "No plan yet",
        body: "Add tasks for this day, or use weekly mode to copy a routine across several days."
      }
    ),
    tasks.map((t) => /* @__PURE__ */ jsxs("div", { style: styles.scheduleRow, children: [
      /* @__PURE__ */ jsx("span", { style: styles.scheduleTime, children: t.start }),
      /* @__PURE__ */ jsxs("div", { style: { flex: 1 }, children: [
        /* @__PURE__ */ jsx("p", { style: styles.taskSubject, children: t.subject }),
        /* @__PURE__ */ jsx("p", { style: styles.taskTopic, children: t.topic })
      ] }),
      /* @__PURE__ */ jsx("button", { onClick: () => deleteTask(selectedDate, t.id), style: styles.iconBtn, "aria-label": "Delete task", children: /* @__PURE__ */ jsx("i", { className: "ti ti-trash", style: { fontSize: 16 }, "aria-hidden": "true" }) })
    ] }, t.id)),
    !showAdd ? /* @__PURE__ */ jsxs("button", { style: styles.addBtn, onClick: () => setShowAdd(true), children: [
      /* @__PURE__ */ jsx("i", { className: "ti ti-plus", style: { fontSize: 16, marginRight: 6 } }),
      "Add task"
    ] }) : /* @__PURE__ */ jsx(AddTaskForm, { dateKey: selectedDate, addTask, onDone: () => setShowAdd(false) }),
    /* @__PURE__ */ jsxs("div", { style: { ...styles.card, marginTop: "1.5rem" }, children: [
      /* @__PURE__ */ jsxs("p", { style: styles.cardTitle, children: [
        /* @__PURE__ */ jsx("i", { className: "ti ti-calendar-repeat", style: { fontSize: 16, marginRight: 6 }, "aria-hidden": "true" }),
        "Copy today's plan to other days"
      ] }),
      /* @__PURE__ */ jsx("p", { style: { fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 12px" }, children: "Useful for repeating the same weekly routine." }),
      /* @__PURE__ */ jsx(CopyScheduleControl, { data, addTask, sourceDate: selectedDate, dateOptions })
    ] })
  ] });
}
function CopyScheduleControl({ data, addTask, sourceDate, dateOptions }) {
  const [target, setTarget] = useState(dateOptions[1]);
  const sourceTasks = data.schedule[sourceDate] || [];
  function copy() {
    sourceTasks.forEach((t) => {
      addTask(target, { subject: t.subject, topic: t.topic, start: t.start, end: t.end, notes: t.notes });
    });
  }
  return /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8 }, children: [
    /* @__PURE__ */ jsx("select", { value: target, onChange: (e) => setTarget(e.target.value), style: { flex: 1 }, children: dateOptions.slice(1).map((dk) => /* @__PURE__ */ jsx("option", { value: dk, children: formatDateLabel(dk) }, dk)) }),
    /* @__PURE__ */ jsx("button", { onClick: copy, disabled: sourceTasks.length === 0, style: { width: 80 }, children: "Copy" })
  ] });
}
function ProgressView({ data }) {
  const last7 = Array.from({ length: 7 }, (_, i) => todayKey(-6 + i));
  let streak = 0;
  for (let i = 0; i < 30; i++) {
    const dk = todayKey(-i);
    const tasks = data.schedule[dk] || [];
    if (tasks.length === 0) break;
    const completed = tasks.filter((t) => t.status === "completed").length;
    if (completed / tasks.length >= 0.8) {
      streak++;
    } else {
      break;
    }
  }
  const subjectStats = {};
  Object.values(data.schedule).flat().forEach((t) => {
    if (!subjectStats[t.subject]) subjectStats[t.subject] = { planned: 0, actual: 0, completed: 0, skipped: 0, total: 0 };
    const s = subjectStats[t.subject];
    s.planned += (timeToMinutes(t.end) - timeToMinutes(t.start)) * 60;
    s.actual += t.actualSeconds || 0;
    s.total += 1;
    if (t.status === "completed") s.completed += 1;
    if (t.status === "skipped") s.skipped += 1;
  });
  const chartData = Object.entries(subjectStats).map(([subject, s]) => ({
    subject,
    planned: Math.round(s.planned / 60),
    actual: Math.round(s.actual / 60)
  }));
  const mostSkipped = Object.entries(subjectStats).filter(([, s]) => s.skipped > 0).sort((a, b) => b[1].skipped - a[1].skipped).slice(0, 3);
  const weeklyCompletion = last7.map((dk) => {
    const tasks = data.schedule[dk] || [];
    const completed = tasks.filter((t) => t.status === "completed").length;
    return { date: dk, label: formatDateLabel(dk).split(",")[0], pct: tasks.length ? Math.round(completed / tasks.length * 100) : 0, total: tasks.length };
  });
  return /* @__PURE__ */ jsxs("div", { style: styles.section, children: [
    /* @__PURE__ */ jsx("p", { style: styles.sectionTitle, children: "Your progress" }),
    /* @__PURE__ */ jsxs("div", { style: styles.statsGrid, children: [
      /* @__PURE__ */ jsxs("div", { style: styles.statCard, children: [
        /* @__PURE__ */ jsx("p", { style: styles.statLabel, children: "Current streak" }),
        /* @__PURE__ */ jsxs("p", { style: styles.statValue, children: [
          /* @__PURE__ */ jsx("i", { className: "ti ti-flame", style: { fontSize: 20, marginRight: 4, verticalAlign: -3 }, "aria-hidden": "true" }),
          streak,
          " days"
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: styles.statCard, children: [
        /* @__PURE__ */ jsx("p", { style: styles.statLabel, children: "Subjects tracked" }),
        /* @__PURE__ */ jsx("p", { style: styles.statValue, children: Object.keys(subjectStats).length })
      ] })
    ] }),
    /* @__PURE__ */ jsx("p", { style: styles.cardTitle, children: "Last 7 days" }),
    /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 6, marginBottom: "1.5rem" }, children: weeklyCompletion.map((d) => /* @__PURE__ */ jsxs("div", { style: { flex: 1, textAlign: "center" }, children: [
      /* @__PURE__ */ jsx("div", { style: styles.barOuter, children: /* @__PURE__ */ jsx("div", { style: { ...styles.barInner, height: `${Math.max(d.pct, 4)}%`, background: d.total === 0 ? "var(--color-border-tertiary)" : "var(--color-text-info)" } }) }),
      /* @__PURE__ */ jsx("p", { style: styles.barLabel, children: d.label })
    ] }, d.date)) }),
    chartData.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("p", { style: styles.cardTitle, children: "Planned vs actual time (minutes)" }),
      /* @__PURE__ */ jsx("div", { style: { width: "100%", height: 220, marginBottom: "1.5rem" }, children: /* @__PURE__ */ jsx(ResponsiveContainer, { children: /* @__PURE__ */ jsxs(BarChart, { data: chartData, children: [
        /* @__PURE__ */ jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "var(--color-border-tertiary)" }),
        /* @__PURE__ */ jsx(XAxis, { dataKey: "subject", tick: { fontSize: 11, fill: "var(--color-text-secondary)" } }),
        /* @__PURE__ */ jsx(YAxis, { tick: { fontSize: 11, fill: "var(--color-text-secondary)" } }),
        /* @__PURE__ */ jsx(Tooltip, { contentStyle: { fontSize: 12, background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)" } }),
        /* @__PURE__ */ jsx(Bar, { dataKey: "planned", fill: "#AFA9EC", name: "Planned", radius: [4, 4, 0, 0] }),
        /* @__PURE__ */ jsx(Bar, { dataKey: "actual", fill: "#5DCAA5", name: "Actual", radius: [4, 4, 0, 0] })
      ] }) }) })
    ] }),
    mostSkipped.length > 0 && /* @__PURE__ */ jsxs("div", { style: styles.card, children: [
      /* @__PURE__ */ jsxs("p", { style: styles.cardTitle, children: [
        /* @__PURE__ */ jsx("i", { className: "ti ti-alert-triangle", style: { fontSize: 16, marginRight: 6 }, "aria-hidden": "true" }),
        "Most skipped subjects"
      ] }),
      mostSkipped.map(([subject, s]) => /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }, children: [
        /* @__PURE__ */ jsx("span", { children: subject }),
        /* @__PURE__ */ jsxs("span", { style: { color: "var(--color-text-secondary)" }, children: [
          s.skipped,
          " of ",
          s.total,
          " skipped"
        ] })
      ] }, subject))
    ] }),
    chartData.length === 0 && /* @__PURE__ */ jsx(EmptyState, { icon: "ti-chart-bar", title: "No data yet", body: "Complete a few scheduled tasks to see your progress here." })
  ] });
}
function QuizView({ data, setData }) {
  const [showAdd, setShowAdd] = useState(false);
  const [active, setActive] = useState(null);
  const [filterSubject, setFilterSubject] = useState("all");
  const subjects = Array.from(new Set(data.quizBank.map((q) => q.subject)));
  const filtered = filterSubject === "all" ? data.quizBank : data.quizBank.filter((q) => q.subject === filterSubject);
  function addQuiz(q) {
    setData((d) => ({ ...d, quizBank: [...d.quizBank, { id: genId(), ...q }] }));
  }
  function deleteQuiz(id) {
    setData((d) => ({ ...d, quizBank: d.quizBank.filter((q) => q.id !== id) }));
  }
  function startSession() {
    const shuffled = [...filtered].sort(() => Math.random() - 0.5).slice(0, Math.min(10, filtered.length));
    if (shuffled.length === 0) return;
    setActive({ questions: shuffled, index: 0, score: 0, answers: [] });
  }
  if (active) {
    return /* @__PURE__ */ jsx(QuizSession, { session: active, setSession: setActive, onFinish: () => setActive(null) });
  }
  return /* @__PURE__ */ jsxs("div", { style: styles.section, children: [
    /* @__PURE__ */ jsx("p", { style: styles.sectionTitle, children: "Quiz & MCQ practice" }),
    /* @__PURE__ */ jsx("p", { style: { fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 1rem" }, children: "Add MCQs from your PYQ books here. After finishing a topic, run a quick quiz to reinforce it." }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, marginBottom: "1rem" }, children: [
      /* @__PURE__ */ jsxs("select", { value: filterSubject, onChange: (e) => setFilterSubject(e.target.value), style: { flex: 1 }, children: [
        /* @__PURE__ */ jsxs("option", { value: "all", children: [
          "All subjects (",
          data.quizBank.length,
          ")"
        ] }),
        subjects.map((s) => /* @__PURE__ */ jsxs("option", { value: s, children: [
          s,
          " (",
          data.quizBank.filter((q) => q.subject === s).length,
          ")"
        ] }, s))
      ] }),
      /* @__PURE__ */ jsx("button", { onClick: startSession, disabled: filtered.length === 0, style: { width: 100 }, children: "Start quiz" })
    ] }),
    filtered.length === 0 && /* @__PURE__ */ jsx(EmptyState, { icon: "ti-pencil-question", title: "No questions yet", body: "Add MCQs from your PYQ book to build a custom quiz bank for this topic.", actionLabel: "Add a question", onAction: () => setShowAdd(true) }),
    !showAdd ? filtered.length > 0 && /* @__PURE__ */ jsxs("button", { style: styles.addBtn, onClick: () => setShowAdd(true), children: [
      /* @__PURE__ */ jsx("i", { className: "ti ti-plus", style: { fontSize: 16, marginRight: 6 } }),
      "Add question"
    ] }) : /* @__PURE__ */ jsx(AddQuizForm, { addQuiz, onDone: () => setShowAdd(false) }),
    filtered.map((q) => /* @__PURE__ */ jsxs("div", { style: styles.taskCard, children: [
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between" }, children: [
        /* @__PURE__ */ jsx("span", { style: styles.scheduleTime, children: q.subject }),
        /* @__PURE__ */ jsx("button", { onClick: () => deleteQuiz(q.id), style: styles.iconBtn, "aria-label": "Delete question", children: /* @__PURE__ */ jsx("i", { className: "ti ti-trash", style: { fontSize: 16 }, "aria-hidden": "true" }) })
      ] }),
      /* @__PURE__ */ jsx("p", { style: { fontSize: 14, margin: "8px 0" }, children: q.question }),
      /* @__PURE__ */ jsxs("p", { style: { fontSize: 12, color: "var(--color-text-secondary)" }, children: [
        "Correct: ",
        q.options[q.correctIndex]
      ] })
    ] }, q.id))
  ] });
}
function AddQuizForm({ addQuiz, onDone }) {
  const [subject, setSubject] = useState("");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correctIndex, setCorrectIndex] = useState(0);
  function submit() {
    if (!subject.trim() || !question.trim() || options.some((o) => !o.trim())) return;
    addQuiz({ subject, question, options, correctIndex });
    setSubject("");
    setQuestion("");
    setOptions(["", "", "", ""]);
    setCorrectIndex(0);
    onDone();
  }
  return /* @__PURE__ */ jsxs("div", { style: styles.card, children: [
    /* @__PURE__ */ jsx("p", { style: styles.cardTitle, children: "New question" }),
    /* @__PURE__ */ jsxs("div", { style: styles.formGrid, children: [
      /* @__PURE__ */ jsx("input", { placeholder: "Subject (e.g. Polity)", value: subject, onChange: (e) => setSubject(e.target.value) }),
      /* @__PURE__ */ jsx("textarea", { placeholder: "Question text", value: question, onChange: (e) => setQuestion(e.target.value), rows: 2 }),
      options.map((opt, i) => /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "radio",
            name: "correct",
            checked: correctIndex === i,
            onChange: () => setCorrectIndex(i),
            "aria-label": `Mark option ${i + 1} as correct`
          }
        ),
        /* @__PURE__ */ jsx(
          "input",
          {
            placeholder: `Option ${i + 1}`,
            value: opt,
            onChange: (e) => {
              const next = [...options];
              next[i] = e.target.value;
              setOptions(next);
            },
            style: { flex: 1 }
          }
        )
      ] }, i))
    ] }),
    /* @__PURE__ */ jsx("p", { style: { fontSize: 12, color: "var(--color-text-secondary)", margin: "8px 0" }, children: "Select the radio button next to the correct answer." }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8 }, children: [
      /* @__PURE__ */ jsx("button", { onClick: submit, style: { flex: 1 }, children: "Add" }),
      /* @__PURE__ */ jsx("button", { onClick: onDone, style: { flex: 1 }, children: "Cancel" })
    ] })
  ] });
}
function QuizSession({ session, setSession, onFinish }) {
  const { questions, index, score, answers } = session;
  const q = questions[index];
  const [selected, setSelected] = useState(null);
  const [revealed, setRevealed] = useState(false);
  function submitAnswer() {
    if (selected === null) return;
    const correct = selected === q.correctIndex;
    setRevealed(true);
    setSession((s) => ({ ...s, score: s.score + (correct ? 1 : 0), answers: [...s.answers, { correct }] }));
  }
  function next() {
    if (index + 1 >= questions.length) {
      onFinish();
      return;
    }
    setSession((s) => ({ ...s, index: s.index + 1 }));
    setSelected(null);
    setRevealed(false);
  }
  if (!q) {
    return /* @__PURE__ */ jsxs("div", { style: styles.section, children: [
      /* @__PURE__ */ jsx("p", { style: styles.sectionTitle, children: "Session complete" }),
      /* @__PURE__ */ jsxs("p", { children: [
        "You scored ",
        score,
        " out of ",
        questions.length,
        "."
      ] }),
      /* @__PURE__ */ jsx("button", { onClick: onFinish, style: { marginTop: 12 }, children: "Back to quiz bank" })
    ] });
  }
  return /* @__PURE__ */ jsxs("div", { style: styles.section, children: [
    /* @__PURE__ */ jsxs("p", { style: styles.dateLabel, children: [
      "Question ",
      index + 1,
      " of ",
      questions.length,
      " \xB7 ",
      q.subject
    ] }),
    /* @__PURE__ */ jsxs("div", { style: styles.card, children: [
      /* @__PURE__ */ jsx("p", { style: { fontSize: 15, margin: "0 0 12px" }, children: q.question }),
      q.options.map((opt, i) => {
        let bg = "var(--color-background-primary)";
        if (revealed) {
          if (i === q.correctIndex) bg = "var(--color-background-success)";
          else if (i === selected) bg = "var(--color-background-danger)";
        } else if (i === selected) {
          bg = "var(--color-background-secondary)";
        }
        return /* @__PURE__ */ jsx(
          "button",
          {
            onClick: () => !revealed && setSelected(i),
            style: { ...styles.optionBtn, background: bg, textAlign: "left" },
            children: opt
          },
          i
        );
      }),
      !revealed ? /* @__PURE__ */ jsx("button", { onClick: submitAnswer, disabled: selected === null, style: { marginTop: 12, width: "100%" }, children: "Submit answer" }) : /* @__PURE__ */ jsx("button", { onClick: next, style: { marginTop: 12, width: "100%" }, children: index + 1 >= questions.length ? "Finish" : "Next question" })
    ] }),
    /* @__PURE__ */ jsxs("p", { style: { fontSize: 13, color: "var(--color-text-secondary)" }, children: [
      "Score so far: ",
      score,
      " / ",
      answers.length
    ] })
  ] });
}
function QuizReminderModal({ task, onClose, onGoToQuiz }) {
  return /* @__PURE__ */ jsx("div", { style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "1rem" }, children: /* @__PURE__ */ jsxs("div", { style: { background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: "1.5rem", maxWidth: 320, width: "100%" }, children: [
    /* @__PURE__ */ jsxs("p", { style: { fontSize: 16, fontWeight: 500, margin: "0 0 8px" }, children: [
      /* @__PURE__ */ jsx("i", { className: "ti ti-pencil-question", style: { fontSize: 18, marginRight: 6, verticalAlign: -3 }, "aria-hidden": "true" }),
      "Topic done \u2014 time to test it"
    ] }),
    /* @__PURE__ */ jsxs("p", { style: { fontSize: 14, color: "var(--color-text-secondary)", margin: "0 0 16px" }, children: [
      'You finished "',
      task.topic,
      '". Run a quick quiz or an MCQ set from your PYQ book on this topic before moving on.'
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8 }, children: [
      /* @__PURE__ */ jsx("button", { onClick: onGoToQuiz, style: { flex: 1 }, children: "Go to quiz bank" }),
      /* @__PURE__ */ jsx("button", { onClick: onClose, style: { flex: 1 }, children: "Later" })
    ] })
  ] }) });
}
function SettingsView({ data, setData }) {
  const [examName, setExamName] = useState(data.examName);
  const [examDate, setExamDate] = useState(data.examDate);
  function save() {
    setData((d) => ({ ...d, examName, examDate }));
  }
  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "exam-prep-backup.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  function clearAll() {
    if (window.confirm("This will delete all your schedule, logs and quiz data. Continue?")) {
      setData(defaultData);
    }
  }
  return /* @__PURE__ */ jsxs("div", { style: styles.section, children: [
    /* @__PURE__ */ jsx("p", { style: styles.sectionTitle, children: "Settings" }),
    /* @__PURE__ */ jsxs("div", { style: styles.card, children: [
      /* @__PURE__ */ jsx("p", { style: styles.cardTitle, children: "Exam details" }),
      /* @__PURE__ */ jsxs("div", { style: styles.formGrid, children: [
        /* @__PURE__ */ jsx("input", { placeholder: "Exam name (e.g. UPSC CSE Prelims)", value: examName, onChange: (e) => setExamName(e.target.value) }),
        /* @__PURE__ */ jsx("input", { type: "date", value: examDate, onChange: (e) => setExamDate(e.target.value) })
      ] }),
      /* @__PURE__ */ jsx("button", { onClick: save, style: { marginTop: 12, width: "100%" }, children: "Save" })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: styles.card, children: [
      /* @__PURE__ */ jsx("p", { style: styles.cardTitle, children: "Data" }),
      /* @__PURE__ */ jsx("p", { style: { fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 12px" }, children: "All data is stored on this device. Export a backup periodically." }),
      /* @__PURE__ */ jsxs("button", { onClick: exportData, style: { width: "100%", marginBottom: 8 }, children: [
        /* @__PURE__ */ jsx("i", { className: "ti ti-download", style: { fontSize: 16, marginRight: 6 }, "aria-hidden": "true" }),
        "Export backup"
      ] }),
      /* @__PURE__ */ jsxs("button", { onClick: clearAll, style: { width: "100%", color: "var(--color-text-danger)" }, children: [
        /* @__PURE__ */ jsx("i", { className: "ti ti-trash", style: { fontSize: 16, marginRight: 6 }, "aria-hidden": "true" }),
        "Clear all data"
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: styles.card, children: [
      /* @__PURE__ */ jsx("p", { style: styles.cardTitle, children: "About" }),
      /* @__PURE__ */ jsx("p", { style: { fontSize: 13, color: "var(--color-text-secondary)" }, children: 'Prep Tracker \xB7 works offline \xB7 install via "Add to Home screen" in Chrome.' })
    ] })
  ] });
}
function EmptyState({ icon, title, body, actionLabel, onAction }) {
  return /* @__PURE__ */ jsxs("div", { style: styles.emptyState, children: [
    /* @__PURE__ */ jsx("i", { className: icon, style: { fontSize: 32, color: "var(--color-text-tertiary)" }, "aria-hidden": "true" }),
    /* @__PURE__ */ jsx("p", { style: { fontWeight: 500, margin: "12px 0 4px" }, children: title }),
    /* @__PURE__ */ jsx("p", { style: { fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 12px" }, children: body }),
    actionLabel && /* @__PURE__ */ jsx("button", { onClick: onAction, children: actionLabel })
  ] });
}
function BottomNav({ tab, setTab }) {
  const items = [
    { id: "today", icon: "ti-checkbox", label: "Today" },
    { id: "schedule", icon: "ti-calendar", label: "Schedule" },
    { id: "progress", icon: "ti-chart-bar", label: "Progress" },
    { id: "quiz", icon: "ti-pencil-question", label: "Quiz" },
    { id: "settings", icon: "ti-settings", label: "Settings" }
  ];
  return /* @__PURE__ */ jsx("div", { style: styles.bottomNav, children: items.map((item) => /* @__PURE__ */ jsxs(
    "button",
    {
      onClick: () => setTab(item.id),
      style: {
        ...styles.navBtn,
        color: tab === item.id ? "var(--color-accent-gold)" : "rgba(250,246,238,0.55)"
      },
      children: [
        /* @__PURE__ */ jsx("i", { className: item.icon, style: { fontSize: 20 }, "aria-hidden": "true" }),
        /* @__PURE__ */ jsx("span", { style: { fontSize: 11 }, children: item.label })
      ]
    },
    item.id
  )) });
}
var styles = {
  app: {
    display: "flex",
    flexDirection: "column",
    minHeight: "100vh",
    maxWidth: 480,
    margin: "0 auto",
    fontFamily: "var(--font-sans)",
    paddingBottom: 70,
    background: "var(--color-background-tertiary)"
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "1.1rem 1.25rem",
    background: "var(--color-ink)",
    color: "#FAF6EE"
  },
  appName: { fontSize: 19, fontWeight: 600, margin: 0, fontFamily: "var(--font-serif)", color: "#FAF6EE", letterSpacing: "0.01em" },
  examLabel: { fontSize: 12, color: "rgba(250,246,238,0.65)", margin: 0 },
  countdownBadge: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    background: "rgba(250,246,238,0.12)",
    border: "0.5px solid rgba(250,246,238,0.25)",
    borderRadius: "var(--border-radius-md)",
    padding: "4px 12px"
  },
  countdownNum: { fontSize: 17, fontWeight: 600, color: "var(--color-accent-gold)", fontFamily: "var(--font-serif)" },
  countdownLabel: { fontSize: 10, color: "rgba(250,246,238,0.65)" },
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid rgba(250,246,238,0.25)",
    background: "transparent",
    color: "#FAF6EE",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },
  content: { flex: 1, padding: "1.25rem 1.25rem" },
  section: {},
  sectionTitle: { fontSize: 19, fontWeight: 600, margin: "0 0 1rem", fontFamily: "var(--font-serif)" },
  dateLabel: { fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 },
  progressBarOuter: {
    width: "100%",
    height: 10,
    background: "var(--color-background-secondary)",
    borderRadius: "var(--border-radius-md)",
    overflow: "hidden",
    border: "0.5px solid var(--color-border-tertiary)"
  },
  progressBarInner: {
    height: "100%",
    background: "linear-gradient(90deg, var(--color-ink), var(--color-text-info))",
    transition: "width 0.3s"
  },
  progressText: { fontSize: 13, color: "var(--color-text-secondary)", margin: "6px 0 0" },
  taskCard: {
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderLeft: "3px solid var(--color-border-info)",
    borderRadius: "var(--border-radius-lg)",
    padding: "1rem 1.25rem",
    marginBottom: 12,
    boxShadow: "0 1px 3px rgba(43,41,36,0.04)"
  },
  taskTime: { fontSize: 12, color: "var(--color-text-secondary)", margin: 0 },
  taskSubject: { fontSize: 15, fontWeight: 500, margin: "2px 0" },
  taskTopic: { fontSize: 13, color: "var(--color-text-secondary)", margin: 0 },
  taskNotes: { fontSize: 12, color: "var(--color-text-tertiary)", margin: "4px 0 0" },
  statusBadge: {
    fontSize: 11,
    padding: "4px 10px",
    borderRadius: "var(--border-radius-md)",
    whiteSpace: "nowrap",
    marginLeft: 8
  },
  taskFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 12,
    borderTop: "0.5px solid var(--color-border-tertiary)"
  },
  timeSpent: { fontSize: 12, color: "var(--color-text-secondary)" },
  iconBtn: {
    width: 32,
    height: 32,
    padding: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },
  addBtn: { width: "100%", margin: "0 0 1rem" },
  card: {
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-lg)",
    padding: "1rem 1.25rem",
    marginBottom: 12
  },
  cardTitle: { fontSize: 14, fontWeight: 500, margin: "0 0 8px" },
  formGrid: { display: "flex", flexDirection: "column", gap: 8 },
  distractionList: { listStyle: "none", padding: 0, margin: "12px 0 0" },
  distractionItem: { fontSize: 13, padding: "4px 0", borderTop: "0.5px solid var(--color-border-tertiary)" },
  emptyState: { textAlign: "center", padding: "2rem 1rem" },
  dateChips: { display: "flex", gap: 6, overflowX: "auto", marginBottom: "1rem", paddingBottom: 4 },
  dateChip: {
    flexShrink: 0,
    fontSize: 12,
    padding: "6px 12px",
    borderRadius: "var(--border-radius-md)",
    border: "0.5px solid var(--color-border-secondary)",
    background: "transparent"
  },
  dateChipActive: {
    background: "var(--color-background-info)",
    color: "var(--color-text-info)",
    borderColor: "var(--color-border-info)"
  },
  scheduleRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 0",
    borderBottom: "0.5px solid var(--color-border-tertiary)"
  },
  scheduleTime: { fontSize: 12, color: "var(--color-text-secondary)", minWidth: 50 },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginBottom: "1.5rem" },
  statCard: {
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-lg)",
    padding: "1rem"
  },
  statLabel: { fontSize: 12, color: "var(--color-text-secondary)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" },
  statValue: { fontSize: 24, fontWeight: 600, margin: 0, fontFamily: "var(--font-serif)", color: "var(--color-accent-gold)" },
  barOuter: {
    height: 80,
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-md)",
    display: "flex",
    alignItems: "flex-end",
    overflow: "hidden"
  },
  barInner: { width: "100%", borderRadius: "var(--border-radius-md) var(--border-radius-md) 0 0" },
  barLabel: { fontSize: 10, color: "var(--color-text-secondary)", margin: "4px 0 0" },
  bottomNav: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    maxWidth: 480,
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-around",
    background: "var(--color-ink)",
    padding: "8px 0"
  },
  navBtn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    background: "transparent",
    border: "none",
    padding: "4px 8px"
  },
  optionBtn: {
    width: "100%",
    marginBottom: 8,
    border: "0.5px solid var(--color-border-tertiary)"
  }
};
export {
  App as default
};
