import { useEffect, useState } from "react";
import ExampleCard from "./ExampleCard.jsx";

export default function Annotator({ example, onSubmit, onSkip }) {
  const [answer, setAnswer] = useState("");
  const [missing, setMissing] = useState(false);
  const [selectedLetter, setSelectedLetter] = useState(null); // 'A' / 'B' / ...

  useEffect(() => {
    // reset when example changes
    setAnswer("");
    setMissing(false);
    setSelectedLetter(null);
  }, [example?.exampleId]);

  const opts = Array.isArray(example?.options) ? example.options : [];
  const canSubmit = missing || (answer && answer.trim().length > 0);

  function choose(letter) {
    setSelectedLetter(letter);
    setAnswer(letter); // store the letter as the answer
  }

  function submit(e) {
    e.preventDefault();
    onSubmit({ human_prediction: answer, missing_information: missing });
  }

  return (
    <div className="annotator">
      {/* 1) Image + Context + Question */}
      <ExampleCard example={example} />

      {/* 2) Options (if present), shown as A/B/C/D */}
      {opts.length > 0 && (
        <div className="card" style={{marginTop:12}}>
          <div className="card-header"><div className="muted">Options</div></div>
          <div className="card-body">
            <div className="options">
              {opts.map((opt, i) => (
                <label key={i} className={`option ${selectedLetter === opt.label ? "active" : ""}`}>
                  <input
                    type="radio"
                    name="opt"
                    checked={selectedLetter === opt.label}
                    onChange={() => choose(opt.label)}
                  />
                  <span><b style={{marginRight:6}}>{opt.label}.</b>{opt.text}</span>
                </label>
              ))}
            </div>
            <div className="muted" style={{marginTop:8, fontSize:12}}>
              Choosing an option saves the <b>letter</b> (e.g. "A") as the answer. You can type a free-form answer below to override.
            </div>
            {selectedLetter && (
              <button type="button" className="ghost" style={{marginTop:8}}
                      onClick={() => { setSelectedLetter(null); setAnswer(""); }}>
                Clear selection
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3) Missing + Answer input */}
      <form onSubmit={submit} className="form" style={{marginTop:12}}>
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
