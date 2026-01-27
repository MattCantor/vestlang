---
"@mattcantor/vestlang": patch
"@vestlang/types": patch
"@vestlang/dsl": patch
"@vestlang/evaluator": patch
"@vestlang/stringify": patch
"@vestlang/normalizer": patch
"@vestlang/linter": patch
---

Prepare packages for publishing to GitHub Package Registry

- Updated all publishConfig to target GitHub Package Registry consistently
- Updated exports to put types condition first for proper module resolution
- Added files fields to ensure only dist is published
- Updated tsconfig for NodeNext module resolution compatibility
- Added .js extensions to imports for NodeNext consumers
- Moved @vestlang/* from devDependencies to dependencies in facade for type resolution
