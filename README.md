# Stagit

VS Code extension for lightweight Git stash workflows in the Source Control sidebar.

## Develop

1. Install dependencies with `bun install`.
2. Run `bun run compile` once so `out/` exists.
3. Open this folder in VS Code.
4. Start the extension host with **Run Extension** from the Run and Debug view, or press `F5`.

The **Stashes** view appears in the Source Control activity. Inline stash buttons also appear on the built-in Git **Staged Changes** and **Changes** group headers.

## Check

Run these before packaging:

```sh
bun run compile
bun run fmt:check
bun run lint
```

Use `bun run fmt` to apply formatter changes.

## Package

Build a local `.vsix` package with:

```sh
bunx @vscode/vsce package
```

You can also install `vsce` globally and run `vsce package`.

## Install Locally

Install the generated `.vsix` into VS Code with:

```sh
code --install-extension stagit-0.0.1.vsix
```

Reload VS Code after installing if the extension does not appear immediately.
