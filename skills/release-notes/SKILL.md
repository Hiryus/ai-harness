---
name: release-notes
argument-hint: 1.5.0
description: Generate release notes for a new version. Use when the user asks for a changelog, release notes, or a formatted summary of changes in a repository.
---

A new version is created based on current branch (HEAD vs last tag).
If the user does not provide it, generate one based on [semantic versioning](https://semver.org) rules.

Please generate a summary of the changes since the last version.
- Also include changes from upstream repositories if any (if the current repository is a fork, the upstream is the original repository).
- Add a warning with the list of new migrations to run (if any).
- Only list direct dependencies updates (not the dependencies of dependencies).

Format:
- Respect the repository template if any. Else, use the [skill template](./template.md) (skip empty sections).
- If using the skill template, an [example](./example.md) is also provided.
- If the user does not specify an output, create a markdown file named `CHANGELOG.md` in the current directory (or append to it if it exists).

Writing rules:
- Rewrite commits as user-facing one-liners, not raw commit messages.
- Drop CI, test and refactor-only commits.
- Merge related commits into one line.

Never publish, or tag without confirmation.
