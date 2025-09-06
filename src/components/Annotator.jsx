// src/components/Annotator.jsx
import { useEffect, useState } from "react";
import ExampleCard from "./ExampleCard.jsx";

export default function Annotator({ example, onSubmit, onSkip }) {
  const [answer, setAnswer] = useState("");
  const [missing, setMissing] = useState(false);
  const [selectedLetter, setSelectedLetter] = useState(null); // 例如 'A'

  useEffect(() => {
    // 切到新样例时重置
    setAnswer("");
    setMissing(false);
    setSelectedLetter(null);
  }, [example?.exampleId]);

  const opts = Array.isArray(example?.options) ? example.options : [];
  const canSubmit = missing || (answer && answer.trim().length > 0);

  function handleChoose(letter) {
    setSelectedLetter(letter);
    setAnswer(letter); // ✅ 选项 → 直接记录字母（A/B/C/D）
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit({ human_prediction: answer, missing_information: missing });
  }

  return (
    <div className="annotator">
      {/* 1) 先 PDF 图 + 问题 */}
      <ExampleCard example={example} />

      {/* 2) options（如有），显示为 A/B/C/D */}
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
                    onChange={() => handleChoose(opt.label)}
                  />
                  <span>
                    <b style={{marginRight:6}}>{opt.label}.</b>{opt.text}
                  </span>
                </label>
              ))}
            </div>
            <div className="muted" style={{marginTop:8, fontSize:12}}>
              选择后将把 <b>字母</b>（如 “A”）保存为答案；你也可以下方输入自由答案覆盖。
            </div>
            {selectedLetter && (
              <button type="button" className="ghost" style={{marginTop:8}} onClick={() => { setSelectedLetter(null); setAnswer(""); }}>
                清除选中
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3) Missing + 答案输入（自由文本同字段） */}
      <form onSubmit={handleSubmit} className="form" style={{marginTop:12}}>
        <label className="row">
          <input
            type="checkbox"
            checked={missing}
            onChange={(e) => setMissing(e.target.checked)}
          />
          <span>Missing information（无法回答）</span>
        </label>

        {!missing && (
          <>
            <label className="label">答案（human_prediction）</label>
            <textarea
              className="input"
              rows={4}
              placeholder={
                opts.length
                  ? "Click on the option above or enter your answer here..."
                  : "Please enter your answer…"
              }
              value={answer}
              onChange={(e) => {
                const v = e.target.value;
                setAnswer(v);
                // 如果手动输入不是已选字母，则取消选中
                if (selectedLetter && v.trim() !== selectedLetter) {
                  setSelectedLetter(null);
                }
              }}
            />
          </>
        )}

        <div className="actions">
          <button type="button" className="ghost" onClick={onSkip}>Next Example</button>
          <button type="submit" className="primary" disabled={!canSubmit}>Submit</button>
        </div>
      </form>
    </div>
  );
}
