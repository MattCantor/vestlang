import { Program } from "@vestlang/types";

export default function AST({ ast }: { ast: Program }) {
  return (
    <>
      <h3 style={{ marginBottom: 4 }}>AST</h3>
      <pre
        style={{
          background: "var(--ifm-pre-background)",
          padding: 12,
          overflow: "auto",
        }}
      >
        {JSON.stringify(ast, null, 2)}
      </pre>
    </>
  );
}
