export default function TaskSelect({ tasks = [], value = "", onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange && onChange(e.target.value)}
      className="select"
      style={{minWidth: 240}}
    >
      <option value="">Choose Task…</option>
      {tasks.map((t) => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  );
}
