// src/components/ExampleCard.jsx
export default function ExampleCard({ example }) {
  const { exampleId, question, image_url } = example || {};
  return (
    <div className="card">
      <div className="card-header">
        <div className="muted">ID: {exampleId}</div>
      </div>
      <div className="card-body">
        {image_url ? (
          <a href={image_url} target="_blank" rel="noreferrer" title="点击在新标签查看原图">
            <img className="preview" src={image_url} alt="example" />
          </a>
        ) : (
          <div className="noimg">No image</div>
        )}

        {question
          ? <h2 className="question" style={{marginTop:12}}>{question}</h2>
          : <div className="muted" style={{marginTop:12}}>（无 question 字段）</div>}
      </div>
    </div>
  );
}
