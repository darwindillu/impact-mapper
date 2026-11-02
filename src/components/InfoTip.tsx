import type { ReactNode } from "react";

/** A small "?" that opens a short explanation. Works with a click or a tap, not only hover. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="info">
      <summary aria-label={`What is ${label}?`} title={`What is ${label}?`}>
        ?
      </summary>
      <div className="info-body">{children}</div>
    </details>
  );
}
