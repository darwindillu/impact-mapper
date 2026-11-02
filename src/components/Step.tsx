import type { ReactNode } from "react";

/** A numbered step of the flow: 1 choose the code, 2 describe the change, 3 the impact. */
export function Step({ n, title, aside, children, id }: { n: number; title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="panel step" id={id} aria-labelledby={`step-${n}`}>
      <div className="step-head">
        <span className="step-n" aria-hidden="true">
          {n}
        </span>
        <h2 id={`step-${n}`}>{title}</h2>
        {aside && <div className="step-aside">{aside}</div>}
      </div>
      {children}
    </section>
  );
}
