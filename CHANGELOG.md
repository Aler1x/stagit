# Changelog

All notable changes to Stagit are documented in this file.

## [0.0.11] - 2026-04-30

### Changed

- Applying and popping stashes now runs directly without an extra confirmation prompt, making common stash workflows faster.

## [0.0.10] - 2026-04-30

### Added

- Added a command to prune local branches that no longer have a corresponding remote branch.

## [0.0.8] - 2026-04-29

### Changed

- Formatted the codebase with the project formatter.

## [0.0.7] - 2026-04-29

### Fixed

- Improved repository detection by deduplicating repositories and enhancing Git directory lookup.

## [0.0.6] - 2026-04-29

### Changed

- Excluded GitHub workflow files from the packaged extension.

## [0.0.5] - 2026-04-29

### Added

- Added automated release packaging through GitHub Actions.

## Initial Development - 2026-04-28 to 2026-04-29

### Added

- Added the initial VS Code extension scaffold for Stagit.
- Added the Stashes view in the Source Control sidebar.
- Added stash commands for creating, applying, popping, dropping, and previewing stashes.
- Added file-level stash actions for opening, applying, and restoring individual stash file changes.
- Added extension metadata, icon, license, README, TypeScript build setup, linting, and formatting configuration.
- Added a command to copy the current branch name.

[0.0.11]: https://github.com/aler1x/stagit/releases/tag/v0.0.11
[0.0.10]: https://github.com/aler1x/stagit/releases/tag/v0.0.10
[0.0.8]: https://github.com/aler1x/stagit/releases/tag/v0.0.8
[0.0.7]: https://github.com/aler1x/stagit/releases/tag/v0.0.7
[0.0.6]: https://github.com/aler1x/stagit/releases/tag/v0.0.6
[0.0.5]: https://github.com/aler1x/stagit/releases/tag/v0.0.5
