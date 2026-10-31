# Working on Waypoints

- Bump `version` in `spindle.json` with every commit (patch for fixes and small changes, minor for features), and keep `package.json` in step. Lumiverse uses the manifest version to notice updates.
- Run `bun run typecheck`, `bun test`, and `bun run build` before committing; the built `dist/` files are committed.
