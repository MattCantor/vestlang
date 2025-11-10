import { Dispatch, SetStateAction } from "react";

export function DSLInput({
  dsl,
  setDsl,
  error,
}: {
  dsl: string;
  setDsl: Dispatch<SetStateAction<string>>;
  error: string;
}) {
  return (
    <div className="card">
      <div className="card__header">
        <h3 style={{ marginBottom: 0 }}>DSL Statement</h3>
      </div>
      <div className="card__body">
        <textarea
          id="dsl"
          value={dsl}
          onChange={(e) => setDsl(e.target.value)}
          rows={5}
          style={{
            width: "100%",
            minWidth: 0,
            border: "1px solid var(--ifm-toc-border-color)",
            color: "var(--ifm-font-color-base)",
            borderRadius: "var(--ifm-global-radius)",
            padding: "0.25rem 0.75rem",
            fontSize: "1rem",
            fontFamily: "var(--ifm-font-family-monospace)",
            lineHeight: "1.6",
            background: "var(--ifm-background-color)",
          }}
        />
      </div>
      {/* --- DSL Error --- */}
      {error && dsl !== "" && (
        <div className="alert alert--danger margin-top--md">
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontSize: "0.875rem",
              margin: "0.5rem 0 0 0",
              fontFamily: "var(--ifm-font-family-monospace)",
            }}
          >
            {error}
          </pre>
        </div>
      )}
    </div>
  );
}
