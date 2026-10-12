import { useEffect, useState } from "react";
import { api, isBrowserMode } from "../state/project-store";

type Recovery = { jobs: { jobId: string; state: string; interrupted?: boolean }[]; journalErrors: string[] };
export default function RecoveryDialog({ notify }: { notify: (s: string) => void }) {
  const [data, setData] = useState<Recovery>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (isBrowserMode()) return;
    void api<Recovery>("recovery").then((r) => {
      if (r.ok) {
        setData(r.value);
        if (r.value.jobs.some((j) => j.interrupted) || r.value.journalErrors.length) setOpen(true);
      }
    });
  }, []);
  if (!open || !data) return null;
  return (
    <div className="modal-backdrop">
      <section
        className="review-modal panel-stack"
        role="dialog"
        aria-modal="true"
        aria-label="Recovered session"
      >
        <h2>Recovered session</h2>
        <p>
          Your last saved project is open. Interrupted exports remain unfinished; start a new export when
          ready.
        </p>
        {data.jobs
          .filter((j) => j.interrupted)
          .map((job) => (
            <p key={job.jobId}>
              <span className="badge">INTERRUPTED</span> {job.jobId} · {job.state}
            </p>
          ))}
        {data.journalErrors.map((error, i) => (
          <p key={`${i}:${error}`}>{error}</p>
        ))}
        <div className="field-row">
          <button
            onClick={() =>
              void api<{ path: string }>("diagnostics", {}).then((r) =>
                notify(r.ok ? "Diagnostics saved in the project exports folder." : r.error.message),
              )
            }
          >
            Save diagnostics
          </button>
          <button className="primary" onClick={() => setOpen(false)}>
            Continue
          </button>
        </div>
      </section>
    </div>
  );
}
