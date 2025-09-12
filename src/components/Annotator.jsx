// src/components/Annotator.jsx
import { useEffect, useMemo, useState } from "react";
import ExampleCard from "./ExampleCard.jsx";
import { updateQuestion, updateOptions, normalizeOptions } from "../api.js";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export default function Annotator({ task, example, onSubmit, onSkip }) {
  const [ex, setEx] = useState(example);

  // answer state
  const [answer, setAnswer] = useState("");
  const [missing, setMissing] = useState(false);
  const [selectedLetter, setSelectedLetter] = useState(null); // 'A' / 'B' / ...

  // options edit state
  const [editingOpts, setEditingOpts] = useState(false);
  const [optsDraft, setOptsDraft] = useState([]);

  useEffect(() => {
    setEx(example);
    setAnswer("");
    setMissing(false);
    setSelectedLetter(null);
    setEditingOpts(false);
    setOptsDraft([]);
  }, [example?.exampleId]);

  const opts = useMemo(() => Array.isArray(ex?.options) ? ex.options : [], [ex?.options]);

  const canSubmit = missing || (answer && answer.trim().length > 0);

  function choose(letter) {
    setSelectedLetter(letter);
    setAnswer(letter); // save the letter as the answer
  }

  function submit(e) {
    e.preventDefault();
    onSubmit({ human_prediction: answer, missing_information: missing });
  }

  async function handleEditQuestion(newQ) {
    try {
      const res = await updateQuestion({
        task,
        exampleId: ex.exampleId,
        newQuestion: newQ,
        raw: ex.raw
      });
      if (res?.error) { alert(res.error); return false; }
      setEx(prev => ({ ...prev, question: res.question, raw: res.json_blob }));
      return true;
    } catch (e) {
      alert(e.message || String(e));
      return false;
    }
  }

  // ----- Options editing -----
  function startEditOptions() {
    const base = opts.length ? opts : [{label:"A", text:""}, {label:"B", text:""}];
    setOptsDraft(base.map((o, i) => ({
      label: LETTERS[i] || o.label || String(i + 1),
      text: o.text || "",
    })));
    setEditingOpts(true);
  }

  function cancelEditOptions() {
    setEditingOpts(false);
    setOptsDraft([]);
  }

  function setOptText(i, v) {
    setOptsDraft(d => d.map((o, idx) => idx === i ? { ...o, text: v } : o));
  }

  function addOption() {
    setOptsDraft(d => {
      const nextIdx = d.length;
      const label = LETTERS[nextIdx] || String(nextIdx + 1);
      return [...d, { label, text: "" }];
    });
  }

  function removeOption(i) {
    setOptsDraft(d => d.filter((_, idx) => idx !== i).map((o, idx2) => ({
      label: LETTERS[idx2] || o.label || String(idx2 + 1),
      text: o.text
    })));
  }

  async function saveOptions() {
    const clean = optsDraft
      .map((o, i) => ({ label: LETTERS[i] || o.label || String(i + 1), text: (o.text || "").trim() }))
      .filter(o => o.text.length > 0);

    if (!clean.length) { alert("Options cannot be empty."); return; }

    try {
      const res = await updateOptions({
        task,
        exampleId: ex.exampleId,
        newOptions: clean,
        raw: ex.raw
      });
      if (res?.error) { alert(res.error); return; }

      // Recompute normalized options for display
      const normalized = res.options && Array.isArray(res.options)
        ? res.options
        : normalizeOptions(res.json_blob?.options || res.json_blob?.answer_choices);

      setEx(prev => ({
        ...prev,
        options: normalized,
        raw: res.json_blob
      }));

      // If the selected answer letter no longer exists, clear it
      if (selectedLetter && !normalized.find(o => o.label === selectedLetter)) {
        setSelectedLetter(null);
        setAnswer(""); // avoid inconsistent answer
      }

      setEditingOpts(false);
      setOptsDraft([]);
    } catch (e) {
      alert(e.message || String(e));
    }
  }

  return (
    <div className="annotator">
      {/* 1) Image + Context + Question (editable) */}
      <ExampleCard example={ex} onEditQuestion={handleEditQuestion} />

      {/* 2) Options */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="muted">Options</div>
          {!editingOpts ? (
            <button className="ghost" type="button" onClick={startEditOptions}>Edit Options</button>
          ) : null}
        </div>

        {!editingOpts ? (
          <div className="card-body">
            {opts.length ? (
              <>
                <div className="options">
                  {opts.map((opt, i) => (
                    <label key={i} className={`option ${selectedLetter === opt.label ? "active" : ""}`}>
                      <input
                        type="radio"
                        name="opt"
                        checked={selectedLetter === opt.label}
                        onChange={() => choose(opt.label)}
                      />
                      <span><b style={{ marginRight: 6 }}>{opt.label}.</b>{opt.text}</span>
                    </label>
                  ))}
                </div>
                <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                  Choosing an option saves the <b>letter</b> (e.g. "A") as the answer. You can type a free-form answer below to override.
                </div>
                {selectedLetter && (
                  <button
                    type="button"
                    className="ghost"
                    style={{ marginTop: 8 }}
                    onClick={() => { setSelectedLetter(null); setAnswer(""); }}
                  >
                    Clear selection
                  </button>
                )}
              </>
            ) : (
              <div className="muted">No options for this example.</div>
            )}
          </div>
        ) : (
          <div className="card-body">
            <div className="muted" style={{ marginBottom: 8 }}>
              Edit option texts. Letters auto-assign as A, B, C… in order.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {optsDraft.map((o, i) => (
                <div key={i} className="row" style={{ alignItems: "stretch", gap: 8 }}>
                  <div className="label" style={{ minWidth: 28, textAlign: "center", paddingTop: 10 }}>
                    <b>{LETTERS[i] || o.label}</b>
                  </div>
                  <input
                    className="input"
                    type="text"
                    value={o.text}
                    onChange={(e) => setOptText(i, e.target.value)}
                    placeholder={`Option ${LETTERS[i] || i + 1}…`}
                  />
                  <button type="button" className="ghost" onClick={() => removeOption(i)}>Delete</button>
                </div>
              ))}
            </div>

            <div className="actions" style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button type="button" className="ghost" onClick={addOption}>Add option</button>
              <div style={{ flex: 1 }} />
              <button type="button" className="ghost" onClick={cancelEditOptions}>Cancel</button>
              <button type="button" className="primary" onClick={saveOptions}>Save</button>
            </div>
          </div>
        )}
      </div>

      {/* 3) Missing + Answer input */}
      <form onSubmit={submit} className="form" style={{ marginTop: 12 }}>
        <label className="row">
          <input
            type="checkbox"
            checked={missing}
            onChange={(e) => setMissing(e.target.checked)}
          />
          <span>Missing information (unanswerable)</span>
        </label>

        {!missing && (
          <>
            <label className="label">Answer (human_prediction)</label>
            <textarea
              className="input"
              rows={4}
              placeholder={opts.length
                ? "Select A/B/C/D above (letter will be saved), or type a free-form answer…"
                : "Type your answer…"}
              value={answer}
              onChange={(e) => {
                const v = e.target.value;
                setAnswer(v);
                if (selectedLetter && v.trim() !== selectedLetter) setSelectedLetter(null);
              }}
            />
          </>
        )}

        <div className="actions">
          <button type="button" className="ghost" onClick={onSkip}>Next</button>
          <button type="submit" className="primary" disabled={!canSubmit}>Submit</button>
        </div>
      </form>
    </div>
  );
}
