---
"@vestlang/vestlang": minor
---

Add `verifyObservations`, a read that grades a proposed vesting schedule against
dated observations — balance snapshots (vested/unvested share counts) and exact
tranches — reporting each supplied figure's gap from the schedule's own prediction
as a percent of the grant. Exposed through the umbrella and as the
`vestlang_verify_observations` MCP tool.
