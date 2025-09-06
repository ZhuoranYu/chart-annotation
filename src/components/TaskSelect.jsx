export default function TaskSelect({ tasks, value, onChange }) {
  return (
    <select
      className="select"
      value={value || ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">Select a task first…</option>
      {tasks.map((t) => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  );
}
