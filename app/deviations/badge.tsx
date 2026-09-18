import { type DeviationDisplay } from "./presentation.ts";

export function DeviationBadge({ display }: { display: DeviationDisplay }) {
  return (
    <span
      className="deviation-badge"
      style={{ background: display.style.bg, color: display.style.text, borderColor: display.style.border }}
      title={display.title}
    >
      {display.label}
    </span>
  );
}
