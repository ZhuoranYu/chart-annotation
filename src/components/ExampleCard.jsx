// src/components/ExampleCard.jsx

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

export default function ExampleCard({ example }) {
  // ✅ include question again
  const { exampleId, image_url, context, question } = example || {};

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

        {/* 3) Question (back in place) */}
        <div className="question-block" style={{ marginTop: 12 }}>
          <div className="block-title">Question</div>
          <h2 className="question">{question ?? "(no question field)"}</h2>
        </div>
      </div>
    </div>
  );
}
