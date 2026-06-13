import React, { useState, useEffect, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// ---------- Storage helpers ----------
const STORAGE_KEY = 'examPrepData_v1';

const defaultData = {
  schedule: {}, // { '2026-06-13': [ {id, subject, topic, start, end, notes, status, actualSeconds} ] }
  logs: {},     // { '2026-06-13': { distractions: [], reflection: '' } }
  examDate: '',
  examName: '',
  quizBank: [], // { id, subject, question, options[4], correctIndex }
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
    console.error('Save failed', e);
  }
}

// ---------- Date helpers ----------
function todayKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

function formatDateLabel(key) {
  const d = new Date(key + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function formatSeconds(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

// ---------- Quiz bank seed ----------
const seedQuizzes = [];

// ---------- Main App ----------
export default function App() {
  const [data, setData] = useState(loadData);
  const [tab, setTab] = useState('today');
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [activeTimer, setActiveTimer] = useState(null); // task id currently running
  const [tick, setTick] = useState(0);
  const [showQuizPrompt, setShowQuizPrompt] = useState(null); // task object
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const intervalRef = useRef(null);

  useEffect(() => {
    saveData(data);
  }, [data]);

  // Timer tick
  useEffect(() => {
    if (activeTimer) {
      intervalRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [activeTimer]);

  // Notification scheduling check (runs every 30s)
  useEffect(() => {
    const check = () => {
      if (notifPermission !== 'granted') return;
      const now = new Date();
      const key = todayKey();
      const tasks = data.schedule[key] || [];
      tasks.forEach((t) => {
        const [sh, sm] = t.start.split(':').map(Number);
        const startMins = sh * 60 + sm;
        const nowMins = now.getHours() * 60 + now.getMinutes();
        if (nowMins === startMins && t.status === 'pending' && !t._notifiedStart) {
          new Notification('Study time!', { body: `${t.subject}: ${t.topic}` });
          markNotified(key, t.id, '_notifiedStart');
        }
        const [eh, em] = t.end.split(':').map(Number);
        const endMins = eh * 60 + em;
        if (nowMins === endMins + 15 && t.status !== 'completed' && !t._notifiedFollowup) {
          new Notification('Still on track?', { body: `Mark "${t.topic}" done or update its status.` });
          markNotified(key, t.id, '_notifiedFollowup');
        }
      });
    };
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [data, notifPermission]);

  function markNotified(dateKey, taskId, field) {
    setData((d) => {
      const tasks = (d.schedule[dateKey] || []).map((t) =>
        t.id === taskId ? { ...t, [field]: true } : t
      );
      return { ...d, schedule: { ...d.schedule, [dateKey]: tasks } };
    });
  }

  function requestNotifications() {
    if (typeof Notification === 'undefined') return;
    Notification.requestPermission().then(setNotifPermission);
  }

  function addTask(dateKey, task) {
    setData((d) => {
      const existing = d.schedule[dateKey] || [];
      const newTask = { id: genId(), status: 'pending', actualSeconds: 0, ...task };
      const updated = [...existing, newTask].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
      return { ...d, schedule: { ...d.schedule, [dateKey]: updated } };
    });
  }

  function updateTask(dateKey, taskId, updates) {
    setData((d) => {
      const tasks = (d.schedule[dateKey] || []).map((t) => (t.id === taskId ? { ...t, ...updates } : t));
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
      // stop
      setActiveTimer(null);
    } else {
      if (activeTimer) {
        // stop previous
        setActiveTimer(null);
      }
      updateTask(dateKey, task.id, { status: 'in_progress', _timerStart: Date.now() });
      setActiveTimer(task.id);
    }
  }

  function markComplete(dateKey, task) {
    let extraSeconds = 0;
    if (activeTimer === task.id && task._timerStart) {
      extraSeconds = Math.floor((Date.now() - task._timerStart) / 1000);
      setActiveTimer(null);
    }
    updateTask(dateKey, task.id, {
      status: 'completed',
      actualSeconds: (task.actualSeconds || 0) + extraSeconds,
      _timerStart: null,
    });
    setShowQuizPrompt(task);
  }

  function markSkipped(dateKey, task) {
    if (activeTimer === task.id) setActiveTimer(null);
    updateTask(dateKey, task.id, { status: 'skipped', _timerStart: null });
  }

  function getElapsedSeconds(task) {
    let base = task.actualSeconds || 0;
    if (activeTimer === task.id && task._timerStart) {
      base += Math.floor((Date.now() - task._timerStart) / 1000);
    }
    return base;
  }

  return (
    <div style={styles.app}>
      <Header data={data} setData={setData} notifPermission={notifPermission} requestNotifications={requestNotifications} />
      <div style={styles.content}>
        {tab === 'today' && (
          <TodayView
            data={data}
            dateKey={todayKey()}
            addTask={addTask}
            updateTask={updateTask}
            deleteTask={deleteTask}
            toggleTimer={toggleTimer}
            markComplete={markComplete}
            markSkipped={markSkipped}
            activeTimer={activeTimer}
            getElapsedSeconds={getElapsedSeconds}
            setData={setData}
          />
        )}
        {tab === 'schedule' && (
          <ScheduleView
            data={data}
            addTask={addTask}
            deleteTask={deleteTask}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
          />
        )}
        {tab === 'progress' && <ProgressView data={data} />}
        {tab === 'quiz' && <QuizView data={data} setData={setData} />}
        {tab === 'settings' && <SettingsView data={data} setData={setData} />}
      </div>
      {showQuizPrompt && (
        <QuizReminderModal
          task={showQuizPrompt}
          onClose={() => setShowQuizPrompt(null)}
          onGoToQuiz={() => {
            setShowQuizPrompt(null);
            setTab('quiz');
          }}
        />
      )}
      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}

// ---------- Header ----------
function Header({ data, notifPermission, requestNotifications }) {
  const daysLeft = data.examDate
    ? Math.ceil((new Date(data.examDate) - new Date(todayKey())) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div style={styles.header}>
      <div>
        <p style={styles.appName}>Prep Tracker</p>
        {data.examName && (
          <p style={styles.examLabel}>{data.examName}</p>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {daysLeft !== null && (
          <div style={styles.countdownBadge}>
            <span style={styles.countdownNum}>{daysLeft >= 0 ? daysLeft : 0}</span>
            <span style={styles.countdownLabel}>days left</span>
          </div>
        )}
        {notifPermission !== 'granted' && (
          <button onClick={requestNotifications} style={styles.bellBtn} aria-label="Enable notifications">
            <i className="ti ti-bell" style={{ fontSize: 18 }}></i>
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Today View ----------
function TodayView({ data, dateKey, addTask, updateTask, deleteTask, toggleTimer, markComplete, markSkipped, activeTimer, getElapsedSeconds, setData }) {
  const tasks = data.schedule[dateKey] || [];
  const [showAdd, setShowAdd] = useState(false);
  const [reflection, setReflection] = useState(data.logs[dateKey]?.reflection || '');
  const [distractionInput, setDistractionInput] = useState('');

  const completed = tasks.filter((t) => t.status === 'completed').length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  function logDistraction() {
    if (!distractionInput.trim()) return;
    setData((d) => {
      const log = d.logs[dateKey] || { distractions: [], reflection: '' };
      const newLog = { ...log, distractions: [...log.distractions, { text: distractionInput, time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) }] };
      return { ...d, logs: { ...d.logs, [dateKey]: newLog } };
    });
    setDistractionInput('');
  }

  function saveReflection() {
    setData((d) => {
      const log = d.logs[dateKey] || { distractions: [], reflection: '' };
      return { ...d, logs: { ...d.logs, [dateKey]: { ...log, reflection } } };
    });
  }

  const log = data.logs[dateKey] || { distractions: [], reflection: '' };

  if (total === 0) {
    return (
      <div style={styles.section}>
        <div style={styles.dateLabel}>{formatDateLabel(dateKey)}</div>
        <EmptyState
          icon="ti-calendar-plus"
          title="Nothing planned for today"
          body="Add today's schedule, or plan your whole week from the Schedule tab."
          actionLabel="Add a task"
          onAction={() => setShowAdd(true)}
        />
        {showAdd && <AddTaskForm dateKey={dateKey} addTask={addTask} onDone={() => setShowAdd(false)} />}
      </div>
    );
  }

  return (
    <div style={styles.section}>
      <div style={styles.dateLabel}>{formatDateLabel(dateKey)}</div>

      <div style={styles.progressBarOuter}>
        <div style={{ ...styles.progressBarInner, width: `${pct}%` }} />
      </div>
      <p style={styles.progressText}>{completed} of {total} done · {pct}%</p>

      <div style={{ marginTop: '1rem' }}>
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            dateKey={dateKey}
            toggleTimer={toggleTimer}
            markComplete={markComplete}
            markSkipped={markSkipped}
            activeTimer={activeTimer}
            elapsed={getElapsedSeconds(t)}
            deleteTask={deleteTask}
            updateTask={updateTask}
          />
        ))}
      </div>

      {!showAdd ? (
        <button style={styles.addBtn} onClick={() => setShowAdd(true)}>
          <i className="ti ti-plus" style={{ fontSize: 16, marginRight: 6 }}></i>Add task
        </button>
      ) : (
        <AddTaskForm dateKey={dateKey} addTask={addTask} onDone={() => setShowAdd(false)} />
      )}

      <div style={styles.card}>
        <p style={styles.cardTitle}><i className="ti ti-bolt" style={{ fontSize: 16, marginRight: 6 }} aria-hidden="true"></i>Distraction log</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder="What pulled you away?"
            value={distractionInput}
            onChange={(e) => setDistractionInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && logDistraction()}
            style={{ flex: 1 }}
          />
          <button onClick={logDistraction} style={{ width: 60 }}>Log</button>
        </div>
        {log.distractions.length > 0 && (
          <ul style={styles.distractionList}>
            {log.distractions.map((d, i) => (
              <li key={i} style={styles.distractionItem}>
                <span style={{ color: 'var(--color-text-tertiary)', marginRight: 8 }}>{d.time}</span>{d.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={styles.card}>
        <p style={styles.cardTitle}><i className="ti ti-note" style={{ fontSize: 16, marginRight: 6 }} aria-hidden="true"></i>Today's reflection</p>
        <textarea
          placeholder="What went wrong today? What will you change tomorrow?"
          value={reflection}
          onChange={(e) => setReflection(e.target.value)}
          onBlur={saveReflection}
          rows={3}
          style={{ width: '100%', resize: 'vertical' }}
        />
      </div>
    </div>
  );
}

// ---------- Task Card ----------
const statusColors = {
  pending: 'c-gray',
  in_progress: 'c-blue',
  completed: 'c-teal',
  skipped: 'c-coral',
};

const statusLabels = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  skipped: 'Skipped',
};

function TaskCard({ task, dateKey, toggleTimer, markComplete, markSkipped, activeTimer, elapsed, deleteTask, updateTask }) {
  const planned = (timeToMinutes(task.end) - timeToMinutes(task.start)) * 60;
  const isRunning = activeTimer === task.id;

  return (
    <div style={{ ...styles.taskCard, opacity: task.status === 'skipped' ? 0.6 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <p style={styles.taskTime}>{task.start} – {task.end}</p>
          <p style={styles.taskSubject}>{task.subject}</p>
          <p style={styles.taskTopic}>{task.topic}</p>
          {task.notes && <p style={styles.taskNotes}>{task.notes}</p>}
        </div>
        <span className={statusColors[task.status]} style={styles.statusBadge}>
          {statusLabels[task.status]}
        </span>
      </div>

      <div style={styles.taskFooter}>
        <span style={styles.timeSpent}>
          <i className="ti ti-clock" style={{ fontSize: 14, marginRight: 4, verticalAlign: -2 }} aria-hidden="true"></i>
          {formatSeconds(elapsed)} / {formatSeconds(planned)}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {task.status !== 'completed' && task.status !== 'skipped' && (
            <>
              <button onClick={() => toggleTimer(dateKey, task)} style={styles.iconBtn} aria-label={isRunning ? 'Pause timer' : 'Start timer'}>
                <i className={isRunning ? 'ti ti-player-pause' : 'ti ti-player-play'} style={{ fontSize: 16 }} aria-hidden="true"></i>
              </button>
              <button onClick={() => markComplete(dateKey, task)} style={styles.iconBtn} aria-label="Mark complete">
                <i className="ti ti-check" style={{ fontSize: 16 }} aria-hidden="true"></i>
              </button>
              <button onClick={() => markSkipped(dateKey, task)} style={styles.iconBtn} aria-label="Skip task">
                <i className="ti ti-x" style={{ fontSize: 16 }} aria-hidden="true"></i>
              </button>
            </>
          )}
          <button onClick={() => deleteTask(dateKey, task.id)} style={styles.iconBtn} aria-label="Delete task">
            <i className="ti ti-trash" style={{ fontSize: 16 }} aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Add Task Form ----------
function AddTaskForm({ dateKey, addTask, onDone }) {
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [notes, setNotes] = useState('');

  function submit() {
    if (!subject.trim() || !topic.trim()) return;
    addTask(dateKey, { subject, topic, start, end, notes });
    setSubject('');
    setTopic('');
    setNotes('');
    onDone();
  }

  return (
    <div style={styles.card}>
      <p style={styles.cardTitle}>New task</p>
      <div style={styles.formGrid}>
        <input placeholder="Subject (e.g. History)" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <input placeholder="Topic (e.g. Mughal administration)" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={{ flex: 1 }} />
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={{ flex: 1 }} />
        </div>
        <textarea placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={submit} style={{ flex: 1 }}>Add</button>
        <button onClick={onDone} style={{ flex: 1 }}>Cancel</button>
      </div>
    </div>
  );
}

// ---------- Schedule View ----------
function ScheduleView({ data, addTask, deleteTask, selectedDate, setSelectedDate }) {
  const [showAdd, setShowAdd] = useState(false);
  const [weekMode, setWeekMode] = useState(false);

  const dateOptions = Array.from({ length: 8 }, (_, i) => todayKey(i));
  const tasks = data.schedule[selectedDate] || [];

  return (
    <div style={styles.section}>
      <p style={styles.sectionTitle}>Plan ahead</p>
      <div style={styles.dateChips}>
        {dateOptions.map((dk, i) => (
          <button
            key={dk}
            onClick={() => setSelectedDate(dk)}
            style={{
              ...styles.dateChip,
              ...(selectedDate === dk ? styles.dateChipActive : {}),
            }}
          >
            {i === 0 ? 'Today' : formatDateLabel(dk).split(',')[0]}
          </button>
        ))}
      </div>

      <p style={styles.dateLabel}>{formatDateLabel(selectedDate)}</p>

      {tasks.length === 0 && (
        <EmptyState
          icon="ti-calendar-event"
          title="No plan yet"
          body="Add tasks for this day, or use weekly mode to copy a routine across several days."
        />
      )}

      {tasks.map((t) => (
        <div key={t.id} style={styles.scheduleRow}>
          <span style={styles.scheduleTime}>{t.start}</span>
          <div style={{ flex: 1 }}>
            <p style={styles.taskSubject}>{t.subject}</p>
            <p style={styles.taskTopic}>{t.topic}</p>
          </div>
          <button onClick={() => deleteTask(selectedDate, t.id)} style={styles.iconBtn} aria-label="Delete task">
            <i className="ti ti-trash" style={{ fontSize: 16 }} aria-hidden="true"></i>
          </button>
        </div>
      ))}

      {!showAdd ? (
        <button style={styles.addBtn} onClick={() => setShowAdd(true)}>
          <i className="ti ti-plus" style={{ fontSize: 16, marginRight: 6 }}></i>Add task
        </button>
      ) : (
        <AddTaskForm dateKey={selectedDate} addTask={addTask} onDone={() => setShowAdd(false)} />
      )}

      <div style={{ ...styles.card, marginTop: '1.5rem' }}>
        <p style={styles.cardTitle}><i className="ti ti-calendar-repeat" style={{ fontSize: 16, marginRight: 6 }} aria-hidden="true"></i>Copy today's plan to other days</p>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 12px' }}>
          Useful for repeating the same weekly routine.
        </p>
        <CopyScheduleControl data={data} addTask={addTask} sourceDate={selectedDate} dateOptions={dateOptions} />
      </div>
    </div>
  );
}

function CopyScheduleControl({ data, addTask, sourceDate, dateOptions }) {
  const [target, setTarget] = useState(dateOptions[1]);
  const sourceTasks = data.schedule[sourceDate] || [];

  function copy() {
    sourceTasks.forEach((t) => {
      addTask(target, { subject: t.subject, topic: t.topic, start: t.start, end: t.end, notes: t.notes });
    });
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ flex: 1 }}>
        {dateOptions.slice(1).map((dk) => (
          <option key={dk} value={dk}>{formatDateLabel(dk)}</option>
        ))}
      </select>
      <button onClick={copy} disabled={sourceTasks.length === 0} style={{ width: 80 }}>Copy</button>
    </div>
  );
}

// ---------- Progress View ----------
function ProgressView({ data }) {
  const last7 = Array.from({ length: 7 }, (_, i) => todayKey(-6 + i));

  // Streak calc
  let streak = 0;
  for (let i = 0; i < 30; i++) {
    const dk = todayKey(-i);
    const tasks = data.schedule[dk] || [];
    if (tasks.length === 0) break;
    const completed = tasks.filter((t) => t.status === 'completed').length;
    if (completed / tasks.length >= 0.8) {
      streak++;
    } else {
      break;
    }
  }

  // Subject stats
  const subjectStats = {};
  Object.values(data.schedule).flat().forEach((t) => {
    if (!subjectStats[t.subject]) subjectStats[t.subject] = { planned: 0, actual: 0, completed: 0, skipped: 0, total: 0 };
    const s = subjectStats[t.subject];
    s.planned += (timeToMinutes(t.end) - timeToMinutes(t.start)) * 60;
    s.actual += t.actualSeconds || 0;
    s.total += 1;
    if (t.status === 'completed') s.completed += 1;
    if (t.status === 'skipped') s.skipped += 1;
  });

  const chartData = Object.entries(subjectStats).map(([subject, s]) => ({
    subject,
    planned: Math.round(s.planned / 60),
    actual: Math.round(s.actual / 60),
  }));

  const mostSkipped = Object.entries(subjectStats)
    .filter(([, s]) => s.skipped > 0)
    .sort((a, b) => b[1].skipped - a[1].skipped)
    .slice(0, 3);

  const weeklyCompletion = last7.map((dk) => {
    const tasks = data.schedule[dk] || [];
    const completed = tasks.filter((t) => t.status === 'completed').length;
    return { date: dk, label: formatDateLabel(dk).split(',')[0], pct: tasks.length ? Math.round((completed / tasks.length) * 100) : 0, total: tasks.length };
  });

  return (
    <div style={styles.section}>
      <p style={styles.sectionTitle}>Your progress</p>

      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <p style={styles.statLabel}>Current streak</p>
          <p style={styles.statValue}><i className="ti ti-flame" style={{ fontSize: 20, marginRight: 4, verticalAlign: -3 }} aria-hidden="true"></i>{streak} days</p>
        </div>
        <div style={styles.statCard}>
          <p style={styles.statLabel}>Subjects tracked</p>
          <p style={styles.statValue}>{Object.keys(subjectStats).length}</p>
        </div>
      </div>

      <p style={styles.cardTitle} >Last 7 days</p>
      <div style={{ display: 'flex', gap: 6, marginBottom: '1.5rem' }}>
        {weeklyCompletion.map((d) => (
          <div key={d.date} style={{ flex: 1, textAlign: 'center' }}>
            <div style={styles.barOuter}>
              <div style={{ ...styles.barInner, height: `${Math.max(d.pct, 4)}%`, background: d.total === 0 ? 'var(--color-border-tertiary)' : 'var(--color-text-info)' }} />
            </div>
            <p style={styles.barLabel}>{d.label}</p>
          </div>
        ))}
      </div>

      {chartData.length > 0 && (
        <>
          <p style={styles.cardTitle}>Planned vs actual time (minutes)</p>
          <div style={{ width: '100%', height: 220, marginBottom: '1.5rem' }}>
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-tertiary)" />
                <XAxis dataKey="subject" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
                <Tooltip contentStyle={{ fontSize: 12, background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)' }} />
                <Bar dataKey="planned" fill="#AFA9EC" name="Planned" radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" fill="#5DCAA5" name="Actual" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {mostSkipped.length > 0 && (
        <div style={styles.card}>
          <p style={styles.cardTitle}><i className="ti ti-alert-triangle" style={{ fontSize: 16, marginRight: 6 }} aria-hidden="true"></i>Most skipped subjects</p>
          {mostSkipped.map(([subject, s]) => (
            <div key={subject} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
              <span>{subject}</span>
              <span style={{ color: 'var(--color-text-secondary)' }}>{s.skipped} of {s.total} skipped</span>
            </div>
          ))}
        </div>
      )}

      {chartData.length === 0 && (
        <EmptyState icon="ti-chart-bar" title="No data yet" body="Complete a few scheduled tasks to see your progress here." />
      )}
    </div>
  );
}

// ---------- Quiz View ----------
function QuizView({ data, setData }) {
  const [showAdd, setShowAdd] = useState(false);
  const [active, setActive] = useState(null); // quiz session: { questions, index, score, answers }
  const [filterSubject, setFilterSubject] = useState('all');

  const subjects = Array.from(new Set(data.quizBank.map((q) => q.subject)));
  const filtered = filterSubject === 'all' ? data.quizBank : data.quizBank.filter((q) => q.subject === filterSubject);

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
    return <QuizSession session={active} setSession={setActive} onFinish={() => setActive(null)} />;
  }

  return (
    <div style={styles.section}>
      <p style={styles.sectionTitle}>Quiz & MCQ practice</p>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 1rem' }}>
        Add MCQs from your PYQ books here. After finishing a topic, run a quick quiz to reinforce it.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
        <select value={filterSubject} onChange={(e) => setFilterSubject(e.target.value)} style={{ flex: 1 }}>
          <option value="all">All subjects ({data.quizBank.length})</option>
          {subjects.map((s) => (
            <option key={s} value={s}>{s} ({data.quizBank.filter((q) => q.subject === s).length})</option>
          ))}
        </select>
        <button onClick={startSession} disabled={filtered.length === 0} style={{ width: 100 }}>
          Start quiz
        </button>
      </div>

      {filtered.length === 0 && (
        <EmptyState icon="ti-pencil-question" title="No questions yet" body="Add MCQs from your PYQ book to build a custom quiz bank for this topic." actionLabel="Add a question" onAction={() => setShowAdd(true)} />
      )}

      {!showAdd ? (
        filtered.length > 0 && (
          <button style={styles.addBtn} onClick={() => setShowAdd(true)}>
            <i className="ti ti-plus" style={{ fontSize: 16, marginRight: 6 }}></i>Add question
          </button>
        )
      ) : (
        <AddQuizForm addQuiz={addQuiz} onDone={() => setShowAdd(false)} />
      )}

      {filtered.map((q) => (
        <div key={q.id} style={styles.taskCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={styles.scheduleTime}>{q.subject}</span>
            <button onClick={() => deleteQuiz(q.id)} style={styles.iconBtn} aria-label="Delete question">
              <i className="ti ti-trash" style={{ fontSize: 16 }} aria-hidden="true"></i>
            </button>
          </div>
          <p style={{ fontSize: 14, margin: '8px 0' }}>{q.question}</p>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            Correct: {q.options[q.correctIndex]}
          </p>
        </div>
      ))}
    </div>
  );
}

function AddQuizForm({ addQuiz, onDone }) {
  const [subject, setSubject] = useState('');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctIndex, setCorrectIndex] = useState(0);

  function submit() {
    if (!subject.trim() || !question.trim() || options.some((o) => !o.trim())) return;
    addQuiz({ subject, question, options, correctIndex });
    setSubject('');
    setQuestion('');
    setOptions(['', '', '', '']);
    setCorrectIndex(0);
    onDone();
  }

  return (
    <div style={styles.card}>
      <p style={styles.cardTitle}>New question</p>
      <div style={styles.formGrid}>
        <input placeholder="Subject (e.g. Polity)" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea placeholder="Question text" value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} />
        {options.map((opt, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="radio"
              name="correct"
              checked={correctIndex === i}
              onChange={() => setCorrectIndex(i)}
              aria-label={`Mark option ${i + 1} as correct`}
            />
            <input
              placeholder={`Option ${i + 1}`}
              value={opt}
              onChange={(e) => {
                const next = [...options];
                next[i] = e.target.value;
                setOptions(next);
              }}
              style={{ flex: 1 }}
            />
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '8px 0' }}>
        Select the radio button next to the correct answer.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={submit} style={{ flex: 1 }}>Add</button>
        <button onClick={onDone} style={{ flex: 1 }}>Cancel</button>
      </div>
    </div>
  );
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
    return (
      <div style={styles.section}>
        <p style={styles.sectionTitle}>Session complete</p>
        <p>You scored {score} out of {questions.length}.</p>
        <button onClick={onFinish} style={{ marginTop: 12 }}>Back to quiz bank</button>
      </div>
    );
  }

  return (
    <div style={styles.section}>
      <p style={styles.dateLabel}>Question {index + 1} of {questions.length} · {q.subject}</p>
      <div style={styles.card}>
        <p style={{ fontSize: 15, margin: '0 0 12px' }}>{q.question}</p>
        {q.options.map((opt, i) => {
          let bg = 'var(--color-background-primary)';
          if (revealed) {
            if (i === q.correctIndex) bg = 'var(--color-background-success)';
            else if (i === selected) bg = 'var(--color-background-danger)';
          } else if (i === selected) {
            bg = 'var(--color-background-secondary)';
          }
          return (
            <button
              key={i}
              onClick={() => !revealed && setSelected(i)}
              style={{ ...styles.optionBtn, background: bg, textAlign: 'left' }}
            >
              {opt}
            </button>
          );
        })}
        {!revealed ? (
          <button onClick={submitAnswer} disabled={selected === null} style={{ marginTop: 12, width: '100%' }}>
            Submit answer
          </button>
        ) : (
          <button onClick={next} style={{ marginTop: 12, width: '100%' }}>
            {index + 1 >= questions.length ? 'Finish' : 'Next question'}
          </button>
        )}
      </div>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Score so far: {score} / {answers.length}</p>
    </div>
  );
}

// ---------- Quiz Reminder Modal ----------
function QuizReminderModal({ task, onClose, onGoToQuiz }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' }}>
      <div style={{ background: 'var(--color-background-primary)', borderRadius: 'var(--border-radius-lg)', padding: '1.5rem', maxWidth: 320, width: '100%' }}>
        <p style={{ fontSize: 16, fontWeight: 500, margin: '0 0 8px' }}>
          <i className="ti ti-pencil-question" style={{ fontSize: 18, marginRight: 6, verticalAlign: -3 }} aria-hidden="true"></i>
          Topic done — time to test it
        </p>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 16px' }}>
          You finished "{task.topic}". Run a quick quiz or an MCQ set from your PYQ book on this topic before moving on.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onGoToQuiz} style={{ flex: 1 }}>Go to quiz bank</button>
          <button onClick={onClose} style={{ flex: 1 }}>Later</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Settings View ----------
function SettingsView({ data, setData }) {
  const [examName, setExamName] = useState(data.examName);
  const [examDate, setExamDate] = useState(data.examDate);

  function save() {
    setData((d) => ({ ...d, examName, examDate }));
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exam-prep-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearAll() {
    if (window.confirm('This will delete all your schedule, logs and quiz data. Continue?')) {
      setData(defaultData);
    }
  }

  return (
    <div style={styles.section}>
      <p style={styles.sectionTitle}>Settings</p>

      <div style={styles.card}>
        <p style={styles.cardTitle}>Exam details</p>
        <div style={styles.formGrid}>
          <input placeholder="Exam name (e.g. UPSC CSE Prelims)" value={examName} onChange={(e) => setExamName(e.target.value)} />
          <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
        </div>
        <button onClick={save} style={{ marginTop: 12, width: '100%' }}>Save</button>
      </div>

      <div style={styles.card}>
        <p style={styles.cardTitle}>Data</p>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 12px' }}>
          All data is stored on this device. Export a backup periodically.
        </p>
        <button onClick={exportData} style={{ width: '100%', marginBottom: 8 }}>
          <i className="ti ti-download" style={{ fontSize: 16, marginRight: 6 }} aria-hidden="true"></i>Export backup
        </button>
        <button onClick={clearAll} style={{ width: '100%', color: 'var(--color-text-danger)' }}>
          <i className="ti ti-trash" style={{ fontSize: 16, marginRight: 6 }} aria-hidden="true"></i>Clear all data
        </button>
      </div>

      <div style={styles.card}>
        <p style={styles.cardTitle}>About</p>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Prep Tracker · works offline · install via "Add to Home screen" in Chrome.
        </p>
      </div>
    </div>
  );
}

// ---------- Shared components ----------
function EmptyState({ icon, title, body, actionLabel, onAction }) {
  return (
    <div style={styles.emptyState}>
      <i className={icon} style={{ fontSize: 32, color: 'var(--color-text-tertiary)' }} aria-hidden="true"></i>
      <p style={{ fontWeight: 500, margin: '12px 0 4px' }}>{title}</p>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 12px' }}>{body}</p>
      {actionLabel && <button onClick={onAction}>{actionLabel}</button>}
    </div>
  );
}

function BottomNav({ tab, setTab }) {
  const items = [
    { id: 'today', icon: 'ti-checkbox', label: 'Today' },
    { id: 'schedule', icon: 'ti-calendar', label: 'Schedule' },
    { id: 'progress', icon: 'ti-chart-bar', label: 'Progress' },
    { id: 'quiz', icon: 'ti-pencil-question', label: 'Quiz' },
    { id: 'settings', icon: 'ti-settings', label: 'Settings' },
  ];
  return (
    <div style={styles.bottomNav}>
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => setTab(item.id)}
          style={{
            ...styles.navBtn,
            color: tab === item.id ? 'var(--color-accent-gold)' : 'rgba(250,246,238,0.55)',
          }}
        >
          <i className={item.icon} style={{ fontSize: 20 }} aria-hidden="true"></i>
          <span style={{ fontSize: 11 }}>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

// ---------- Styles ----------
const styles = {
  app: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    maxWidth: 480,
    margin: '0 auto',
    fontFamily: 'var(--font-sans)',
    paddingBottom: 70,
    background: 'var(--color-background-tertiary)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.1rem 1.25rem',
    background: 'var(--color-ink)',
    color: '#FAF6EE',
  },
  appName: { fontSize: 19, fontWeight: 600, margin: 0, fontFamily: 'var(--font-serif)', color: '#FAF6EE', letterSpacing: '0.01em' },
  examLabel: { fontSize: 12, color: 'rgba(250,246,238,0.65)', margin: 0 },
  countdownBadge: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    background: 'rgba(250,246,238,0.12)',
    border: '0.5px solid rgba(250,246,238,0.25)',
    borderRadius: 'var(--border-radius-md)',
    padding: '4px 12px',
  },
  countdownNum: { fontSize: 17, fontWeight: 600, color: 'var(--color-accent-gold)', fontFamily: 'var(--font-serif)' },
  countdownLabel: { fontSize: 10, color: 'rgba(250,246,238,0.65)' },
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: 'var(--border-radius-md)',
    border: '0.5px solid rgba(250,246,238,0.25)',
    background: 'transparent',
    color: '#FAF6EE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1, padding: '1.25rem 1.25rem' },
  section: {},
  sectionTitle: { fontSize: 19, fontWeight: 600, margin: '0 0 1rem', fontFamily: 'var(--font-serif)' },
  dateLabel: { fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 },
  progressBarOuter: {
    width: '100%',
    height: 10,
    background: 'var(--color-background-secondary)',
    borderRadius: 'var(--border-radius-md)',
    overflow: 'hidden',
    border: '0.5px solid var(--color-border-tertiary)',
  },
  progressBarInner: {
    height: '100%',
    background: 'linear-gradient(90deg, var(--color-ink), var(--color-text-info))',
    transition: 'width 0.3s',
  },
  progressText: { fontSize: 13, color: 'var(--color-text-secondary)', margin: '6px 0 0' },
  taskCard: {
    background: 'var(--color-background-primary)',
    border: '0.5px solid var(--color-border-tertiary)',
    borderLeft: '3px solid var(--color-border-info)',
    borderRadius: 'var(--border-radius-lg)',
    padding: '1rem 1.25rem',
    marginBottom: 12,
    boxShadow: '0 1px 3px rgba(43,41,36,0.04)',
  },
  taskTime: { fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 },
  taskSubject: { fontSize: 15, fontWeight: 500, margin: '2px 0' },
  taskTopic: { fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 },
  taskNotes: { fontSize: 12, color: 'var(--color-text-tertiary)', margin: '4px 0 0' },
  statusBadge: {
    fontSize: 11,
    padding: '4px 10px',
    borderRadius: 'var(--border-radius-md)',
    whiteSpace: 'nowrap',
    marginLeft: 8,
  },
  taskFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTop: '0.5px solid var(--color-border-tertiary)',
  },
  timeSpent: { fontSize: 12, color: 'var(--color-text-secondary)' },
  iconBtn: {
    width: 32,
    height: 32,
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: { width: '100%', margin: '0 0 1rem' },
  card: {
    background: 'var(--color-background-primary)',
    border: '0.5px solid var(--color-border-tertiary)',
    borderRadius: 'var(--border-radius-lg)',
    padding: '1rem 1.25rem',
    marginBottom: 12,
  },
  cardTitle: { fontSize: 14, fontWeight: 500, margin: '0 0 8px' },
  formGrid: { display: 'flex', flexDirection: 'column', gap: 8 },
  distractionList: { listStyle: 'none', padding: 0, margin: '12px 0 0' },
  distractionItem: { fontSize: 13, padding: '4px 0', borderTop: '0.5px solid var(--color-border-tertiary)' },
  emptyState: { textAlign: 'center', padding: '2rem 1rem' },
  dateChips: { display: 'flex', gap: 6, overflowX: 'auto', marginBottom: '1rem', paddingBottom: 4 },
  dateChip: {
    flexShrink: 0,
    fontSize: 12,
    padding: '6px 12px',
    borderRadius: 'var(--border-radius-md)',
    border: '0.5px solid var(--color-border-secondary)',
    background: 'transparent',
  },
  dateChipActive: {
    background: 'var(--color-background-info)',
    color: 'var(--color-text-info)',
    borderColor: 'var(--color-border-info)',
  },
  scheduleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 0',
    borderBottom: '0.5px solid var(--color-border-tertiary)',
  },
  scheduleTime: { fontSize: 12, color: 'var(--color-text-secondary)', minWidth: 50 },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginBottom: '1.5rem' },
  statCard: {
    background: 'var(--color-background-primary)',
    border: '0.5px solid var(--color-border-tertiary)',
    borderRadius: 'var(--border-radius-lg)',
    padding: '1rem',
  },
  statLabel: { fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' },
  statValue: { fontSize: 24, fontWeight: 600, margin: 0, fontFamily: 'var(--font-serif)', color: 'var(--color-accent-gold)' },
  barOuter: {
    height: 80,
    background: 'var(--color-background-primary)',
    border: '0.5px solid var(--color-border-tertiary)',
    borderRadius: 'var(--border-radius-md)',
    display: 'flex',
    alignItems: 'flex-end',
    overflow: 'hidden',
  },
  barInner: { width: '100%', borderRadius: 'var(--border-radius-md) var(--border-radius-md) 0 0' },
  barLabel: { fontSize: 10, color: 'var(--color-text-secondary)', margin: '4px 0 0' },
  bottomNav: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    maxWidth: 480,
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-around',
    background: 'var(--color-ink)',
    padding: '8px 0',
  },
  navBtn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    background: 'transparent',
    border: 'none',
    padding: '4px 8px',
  },
  optionBtn: {
    width: '100%',
    marginBottom: 8,
    border: '0.5px solid var(--color-border-tertiary)',
  },
};
