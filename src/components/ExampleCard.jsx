// src/components/ExampleCard.jsx
import { useEffect, useState } from "react";

// turn **marked** segments into <mark className="hi">marked</mark>
function renderMarked(text) {
  if (!text) return null;
  const parts = [];
  const regex = /\*\*([\s\S]+?)\*\*/g; // non-greedy, spans newlines
  let last = 0, m, key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<mark className="hi" key={`hi-${key++}`}>{m[1]}</mark>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function ExampleCard({ example, onEditQuestion }) {
  const { exampleId, image_url, context, question, explanation } = example || {};
  const [editing, setEditing] = useState(false);
  const [qValue, setQValue] = useState(question || "");

  useEffect(() => {
    setEditing(false);
    setQValue(question || "");
  }, [exampleId, question]);

  async function save() {
    if (!onEditQuestion) return setEditing(false);
    const ok = await onEditQuestion(qValue);
    if (ok !== false) setEditing(false);
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="muted">ID: {exampleId}</div>
      </div>

      <div className="card-body">
        {/* 1) Image */}
        {image_url ? (
          <a href={image_url} target="_blank" rel="noreferrer" title="Open full image in a new tab">
            <img className="preview" src={image_url} alt="example" />
          </a>
        ) : (
          <div className="noimg">No image</div>
        )}

        {/* 2) Context with **bold red** highlights */}
        <div className="context-block" style={{ marginTop: 12 }}>
          <div className="block-title">Context</div>
          <div className="context-box">
            {context ? renderMarked(context) : "(no context field)"}
          </div>
        </div>

        {/* 3) Question (editable) */}
        <div className="question-block" style={{ marginTop: 12 }}>
          <div className="block-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span>Question</span>
            {!editing && onEditQuestion ? (
              <button className="ghost" type="button" onClick={() => setEditing(true)}>Edit</button>
            ) : null}
          </div>

          {!editing ? (
            <h2 className="question">{question ?? "(no question field)"}</h2>
          ) : (
            <div>
              <textarea
                className="input"
                rows={3}
                value={qValue}
                onChange={(e) => setQValue(e.target.value)}
                placeholder="Edit the question…"
              />
              <div className="actions" style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <button type="button" className="ghost" onClick={() => { setEditing(false); setQValue(question || ""); }}>
                  Cancel
                </button>
                <button type="button" className="primary" onClick={save}>
                  Save
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 4) Explanation — collapsed by default */}
        {!!explanation && (
          <details className="disclosure" style={{ marginTop: 12 }}>
            <summary className="block-title">Explanation (click to expand)</summary>
            <div className="explanation-box">
              {explanation}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
