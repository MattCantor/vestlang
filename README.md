# Vestlang

> **A domain-specific language (DSL) for modeling vesting schedules**

**Vestlang** is a work-in-progress DSL designed to describe complex equity vesting schedules in a human-readable, composable format. It aims to be both expressive for lawyers and interpretable by software.

Uses [Peggy](https://peggyjs.org/) to define a robust PEG grammar that compiles to a typed, structured abstract syntax tree (AST).

---

## 🚀 Features

- ✅ Human-friendly DSL syntax for vesting logic  
- ✅ TypeScript-compatible PEG parser using Peggy  
- ✅ Parser generates structured AST  
- 🛠 Compiler logic and schedule calculation coming soon  
- 🔧 Prettier plugin for formatting (planned)  
- ⌨️ CLI playground for rapid testing  

---

## 📦 Packages

| Package                  | Description                                |
|--------------------------|--------------------------------------------|
| `@vestlang/core`         | PEG grammar, parser, and AST definitions   |
| `@vestlang/playground`   | CLI runner for testing DSL examples        |
| *(coming soon)*          | `@vestlang/prettier-plugin` — DSL formatting |
| *(coming soon)*          | `@vestlang/cli` — end-user CLI tool        |

---

## ✨ Example (Future DSL syntax)

```vest
define schedule time_based:
  monthly for 4 years with 1 year cliff

grant 1000 RSUs under schedule time_based
```

---

## 🧱 Project Structure

```
vestlang/
├── packages/
│   └── core/         → parser and grammar
├── apps/
│   └── playground/   → CLI runner for DSL
├── grammar/          → DSL PEG source (compiled to parser)
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
npm run build --workspace=@vestlang/core
npm run dev --workspace=@vestlang/playground
```

---

## 🧪 Example Playground Output

```ts
{
  type: 'Schedule',
  name: 'time_based',
  items: [
    { type: 'Cliff', duration: 12, percent: 25 }
  ]
}
```

This output is produced by `apps/playground` when parsing the following DSL:

```
schedule time_based:
  cliff 12 months: 25%
```

---

## 🗺 Roadmap

- [x] Define PEG grammar
- [x] Generate typed AST
- [ ] Transform AST into structured vesting schedule
- [ ] Format DSL with Prettier plugin
- [ ] Publish CLI tool
- [ ] Add REPL and/or web playground
- [ ] Add VSCode extension (stretch goal)

---

## 🧑‍💻 Contributing

This project is in early stages. If you're interested in vesting logic, compilers, or legal-tech DSLs — feel free to reach out, fork the repo, or open an issue!

---

## 📄 License

MIT
