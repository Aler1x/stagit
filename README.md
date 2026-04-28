# Stagit

VS Code extension scaffold: **Stashes** and **Worktrees** tree views in the Source Control sidebar (same area as Changes / repository sections).

## Develop

1. Install dependencies (`bun install` or `npm install`).
2. Run `bun run compile` or `npm run compile` once so `out/` exists.
3. In VS Code, open this folder and use **Run Extension** from the Run and Debug view (`F5`).

The new views appear when you open the **Source Control** activity; scroll the sidebar to find **Stashes** and **Worktrees**.

## Package

`vsce package` (after a successful compile) produces a `.vsix`. Set `publisher` in `package.json` before publishing.
