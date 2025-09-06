// src/App.jsx
import { useEffect, useState } from "react";
import {
  fetchTasks, fetchExample, submitAnnotation, getStats,
  exportTask, exportTaskCompleted, exportAllCompletedZip
} from "./api.js";
import TaskSelect from "./components/TaskSelect.jsx";
import Annotator from "./components/Annotator.jsx";

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [task, setTask] = useState(null);
  const [current, setCurrent] = useState(null);
  const [stats, setStats] = useState({ total: 0, answered: 0, missing: 0, remaining: 0 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { tasks } = await fetchTasks();
        setTasks(tasks);
      } catch (e) {
        setErr(e.message || String(e));
      }
    })();
  }, []);

  useEffect(() => {
    if (!task) return;
    (async () => {
      await refreshStats(task);
      await loadNext(task);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  async function refreshStats(t) {
    try { setStats(await getStats(t)); } catch (e) { console.warn(e); }
  }

  async function loadNext(t) {
    const which = (t || task || "").trim();
    if (!which) return;
    setLoading(true);
    setErr(null);
    try {
      const { example } = await fetchExample(which);
      setCurrent(example || null);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit({ human_prediction, missing_information }) {
    if (!current) return;
    const res = await submitAnnotation({
      task,
      exampleId: current.exampleId,
      human_prediction,
      missing_information
    });
    if (res?.error) { alert(res.error); return; }
    await refreshStats(task);
    await loadNext(task);
  }

  function onSelectTask(t) {
    const normalized = (t || "").trim().toLowerCase();
    setTask(normalized);
    setCurrent(null);
    setErr(null);
  }

  const done = stats.answered + stats.missing;

  return (
    <div className="container">
      <header className="header">
        <h1>Chart Annotation</h1>
        <div className="toolbar" style={{gap:8}}>
          <TaskSelect tasks={tasks} value={task || ""} onChange={onSelectTask} />
          <button className="ghost" disabled={!task} onClick={() => exportTask(task)}>Export JSON (all)</button>
          <button className="ghost" disabled={!task} onClick={() => exportTaskCompleted(task)}>Export Completed (task)</button>
          <button className="ghost" onClick={() => exportAllCompletedZip()}>Export Completed (ZIP all)</button>
        </div>
      </header>

      {task && (
        <div className="stats" style={{marginTop:8, padding:"8px 12px", border:"1px solid #223046", borderRadius:10}}>
          <b>Task:</b> {task} &nbsp; | &nbsp;
          <b>Total:</b> {stats.total} &nbsp; | &nbsp;
          <b>Done:</b> {done} (<span title="有答案">{stats.answered}</span> + <span title="缺信息">{stats.missing}</span>) &nbsp; | &nbsp;
          <b>Remaining:</b> {stats.remaining}
        </div>
      )}

      {err && <div className="error">Error: {err}</div>}
      {!task && <p className="tip">Select a task first</p>}

      {task && (
        <div className="content">
          {loading && !current && <div className="loading">Loading…</div>}

          {!loading && !current && (
            <div className="empty">
              <p>All examples under the task is completed 🎉</p>
              <button onClick={() => { refreshStats(task); loadNext(task); }}>刷新</button>
            </div>
          )}

          {current && (
            <Annotator
              example={current}
              onSubmit={onSubmit}
              onSkip={() => { refreshStats(task); loadNext(task); }}
            />
          )}
        </div>
      )}
    </div>
  );
}
