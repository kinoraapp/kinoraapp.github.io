import type { ReactNode } from "react";
import type { DayPoint } from "../lib/types";

export function StatCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode }) {
  return (
    <div className="stat-card">
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

/** Daily bars with a hover/focus tooltip for the exact value. */
export function DailyBarChart({ points, field, label }: { points: DayPoint[]; field: "views" | "users"; label: string }) {
  const values = points.map((p) => Number(p[field] ?? 0));
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <figure className="chart">
      <figcaption className="chart-caption">
        <span>{label}</span>
        <span className="muted">
          {total.toLocaleString()} in {points.length} days
        </span>
      </figcaption>
      <div className="chart-bars" role="img" aria-label={`${label}: ${total} over ${points.length} days`}>
        {points.map((p, i) => (
          <div key={p.day} className="chart-col" tabIndex={0} aria-label={`${fmt(p.day)}: ${values[i]}`}>
            <div className="chart-bar" style={{ height: `${Math.max((values[i] / max) * 100, values[i] ? 3 : 0)}%` }} />
            <span className="chart-tip">
              {fmt(p.day)}: <strong>{values[i].toLocaleString()}</strong>
            </span>
          </div>
        ))}
      </div>
      <div className="chart-axis muted small">
        <span>{points[0] ? fmt(points[0].day) : ""}</span>
        <span>{points.length ? fmt(points[points.length - 1].day) : ""}</span>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>{field === "views" ? "Views" : "Sign-ups"}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.day}>
              <td>{fmt(p.day)}</td>
              <td>{values[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
