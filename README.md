# Vestlang

> **A domain-specific language (DSL) for modeling vesting schedules**

Vestlang is a work-in-progress DSL designed to describe complex equity vesting schedules in a human-readable, composable format. It aims to be both expressive for lawyers and stock plan administrators and interpretable by software.

---

## 🚀 Features (Planned)

- ✅ Human-friendly DSL for defining vesting logic  
- ✅ TypeScript parser and compiler
- ✅ Grant and schedule constructs
- ✅ Composite schedules with `and` logic (e.g. "later of")
- 🛠 Compiler transforms DSL to structured AST
- 🛠 Schedule calculation engine (installments)
- 🔧 Prettier plugin for formatting
- ⌨️ CLI playground for rapid testing

---

## 📦 Packages

| Package                  | Description                                |
|--------------------------|--------------------------------------------|
| `@vestlang/core`         | PEG grammar, parser, and AST definitions   |
| `@vestlang/playground`   | CLI for running and testing DSL examples   |
| *(coming soon)*          | `@vestlang/prettier-plugin` — format support |
| *(coming soon)*          | `@vestlang/cli` — user-friendly CLI tool    |

---

## 🧠 How Vestlang Works

At its core, Vestlang parses structured English into an abstract syntax tree (AST) representing **how and when equity grants vest**.

### 🔹 Core Concepts

| Concept       | Description |
|---------------|-------------|
| `schedule`    | A set of vesting rules (e.g. cliff, monthly). Can be defined inline or named for reuse. |
| `grant`       | A declaration that an equity award (e.g. 1000 RSUs) is governed by a schedule. |
| `define`      | Allows creating a named, reusable schedule block. |
| `and`         | Combines schedules with logical conjunction (e.g. vest on the *later of* two schedules). |

### 🔹 Schedule Types

Vesting schedules can include different primitives. So far:

```vest
cliff 12 months: 25%
monthly 36 months: 75%
```

Each line describes:
- a **mechanism** (`cliff`, `monthly`)
- a **duration** (in months)
- a **percent** of the total grant that vests

### 🔹 Reusability

You can define a schedule once and reuse it:

```vest
define schedule time_based:
  cliff 12 months: 25%
  monthly 36 months: 75%

grant 1000 RSUs under schedule time_based
```

### 🔹 Composability

Schedules can be composed using logical conjunction:

```vest
schedule:
  schedule time_based
  and
  schedule milestone_achieved
```

This produces a "composite schedule" that vests only after **both components** occur — a natural way to describe “later of” conditions.

### 🔹 AST Shape (Example)

```ts
{
  type: "Grant",
  amount: 1000,
  unit: "RSU",
  schedule: {
    type: "Composite",
    operator: "and",
    schedules: [
      { type: "ScheduleRef", name: "time_based" },
      { type: "ScheduleRef", name: "milestone_achieved" }
    ]
  }
}
```

### 🔹 Future Plans

- Add support for milestones, performance triggers, and date-based offsets
- Enforce validation rules (e.g. 100% total, known schedule references)
- Compile ASTs into vesting timelines with installment outputs
- Add a Prettier plugin and VSCode extension

---

## 🧱 Project Structure

```
vestlang/
├── packages/
│   └── core/         → parser and compiler
├── apps/
│   └── playground/   → CLI runner for DSL
├── tsconfig.base.json
├── turbo.json
└── README.md
```

---

## 🔧 Getting Started

```bash
git clone https://github.com/YOUR_ORG/vestlang.git
cd vestlang
npm install
npm run dev --workspace=@vestlang/playground
```

---

## 🧑‍💻 Contributing

Early stage! If you're interested in vesting logic, compilers, or legal-tech DSLs — reach out or open an issue!

---

## 📄 License

MIT