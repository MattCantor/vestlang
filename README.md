# Vestlang

> **A domain-specific language (DSL) for modeling vesting schedules**

Vestlang is a work-in-progress DSL designed to describe complex equity vesting schedules in a human-readable, composable format. It aims to be both expressive for lawyers and interpretable by software.

---

## 🚀 Features (Planned)

- ✅ Human-friendly DSL for defining vesting logic  
- ✅ TypeScript parser and compiler
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

## 🧪 Example CLI Output

```bash
Parsed result: {
  message: "Parser not implemented yet",
  input: "define schedule ..."
}
```

---

## 🗺 Roadmap

- [ ] Define PEG grammar
- [ ] Generate AST
- [ ] Transform AST into structured vesting schedule
- [ ] Format DSL with Prettier plugin
- [ ] Publish CLI tool
- [ ] Add VSCode extension (stretch)

---

## 🧑‍💻 Contributing

Early stage! If you're interested in vesting logic, compilers, or legal-tech DSLs — reach out or open an issue!

---

## 📄 License

MIT
