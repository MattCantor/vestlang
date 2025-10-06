import * as React from "react";
import BrowserOnly from "@docusaurus/BrowserOnly";

type ParseFn = (code: string) => unknown;
type NormalizeFn = (ast: unknown) => unknown;

const LS_KEY = "vestlang-playground-input";

const PRESETS = [
  "VEST SCHEDULE OVER 4 years EVERY 1 month",
  "0.5 VEST SCHEDULE FROM EVENT ipo OVER 2 years EVERY 6 months",
  "VEST SCHEDULE FROM LATER OF (EVENT ipo, DATE 2025-01-01) OVER 4 years EVERY 1 month",
];

function json(x: unknown) {
  try { return JSON.stringify(x, null, 2); } catch { return String(x); }
}

export default function VestMiniPlayground() {
  // keep SSR harmless
  const [code, setCode] = React.useState(() =>
    typeof window === "undefined"
      ? PRESETS[0]
      : localStorage.getItem(LS_KEY) ?? PRESETS[0]
  );
  const [ast, setAst] = React.useState<unknown | null>(null);
  const [normalized, setNormalized] = React.useState<unknown | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<boolean>(false);

  const parseRef = React.useRef<ParseFn | null>(null);
  const normRef = React.useRef<NormalizeFn | null>(null);

  // Persist input
  React.useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(LS_KEY, code);
  }, [code]);

  // Load parser/normalizer only in the browser & tolerate different export names
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dslMod: any = await import("@vestlang/dsl");
        const parseCandidate =
          dslMod.parse ??
          dslMod.parseStatement ??
          dslMod.default?.parse ??
          dslMod.default?.parseStatement;
        if (!parseCandidate) {
          throw new Error("Could not find a parse function in @vestlang/dsl");
        }
        if (!cancelled) parseRef.current = parseCandidate;
      } catch (e: any) {
        if (!cancelled) setError(`Failed to load @vestlang/dsl: ${e?.message ?? String(e)}`);
      }

      try {
        const normMod: any = await import("@vestlang/normalizer");
        const normalizeCandidate =
          normMod.normalizeStatement ??
          normMod.normalize ??
          normMod.default?.normalizeStatement ??
          normMod.default?.normalize;
        if (!cancelled) normRef.current = normalizeCandidate ?? null; // optional
      } catch {
        // Normalizer is optional — AST-only mode is fine.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const run = React.useCallback(() => {
    const parse = parseRef.current;
    setLoading(true);
    try {
      if (!parse) return;
      const a = parse(code);
      setAst(a);
      setError(null);

      const normalize = normRef.current;
      if (typeof normalize === "function") {
        try {
          const n = normalize(a);
          setNormalized(n);
        } catch (e: any) {
          setNormalized(null);
          setError(`Normalization error: ${e?.message ?? String(e)}`);
        }
      } else {
        setNormalized(null); // AST-only
      }
    } catch (e: any) {
      setAst(null);
      setNormalized(null);
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [code]);

  // Auto-run with light debounce
  React.useEffect(() => {
    const t = setTimeout(run, 250);
    return () => clearTimeout(t);
  }, [code, run]);

  return (
    <BrowserOnly>
      {() => (
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ fontWeight: 600 }}>Try a vestlang statement</label>

          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={5}
            style={{
              width: "100%",
              fontFamily: "var(--ifm-font-family-monospace)",
              fontSize: "0.9rem",
              padding: 8,
            }}
            placeholder="VEST SCHEDULE OVER 4 years EVERY 1 month"
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="button button--primary" onClick={run} disabled={loading}>
              {loading ? "Running…" : "Run"}
            </button>
            {PRESETS.map((s) => (
              <button
                key={s}
                className="button button--secondary button--sm"
                onClick={() => setCode(s)}
                type="button"
              >
                Sample: {s.slice(0, 32)}
                {s.length > 32 ? "…" : ""}
              </button>
            ))}
          </div>

          {error && (
            <div className="alert alert--danger" role="alert">
              <strong>Error:</strong> {error}
            </div>
          )}

          {ast && (
            <>
              <h3 style={{ marginBottom: 4 }}>AST</h3>
              <pre style={{ background: "var(--ifm-pre-background)", padding: 12, overflow: "auto" }}>
                {json(ast)}
              </pre>
            </>
          )}

          {normalized && (
            <>
              <h3 style={{ marginBottom: 4 }}>Normalized</h3>
              <pre style={{ background: "var(--ifm-pre-background)", padding: 12, overflow: "auto" }}>
                {json(normalized)}
              </pre>
            </>
          )}

          {!ast && !error && (
            <p style={{ color: "var(--ifm-color-emphasis-600)" }}>
              Type above and click <b>Run</b> to parse.
            </p>
          )}
        </div>
      )}
    </BrowserOnly>
  );
}

