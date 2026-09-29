## General rules

- In all interactions and commit messages, be extremely concise and sacrifice grammar for the sake of concision.

## Modes

- The session runs in one of three modes - `manual`, `edit`, or `auto` - set by the user with the `/mode <manual|edit|auto>` command.
- The `manual` mode is the default. Any tool call that is not explicitly allowed requires the user's validation.
- Compared to `manual` mode, the `edit` mode also allows to write allowed files without the user's validation.
- In `auto` mode, only the **allowed** calls will ever run. No validation request will be forwarded to the user.

## Tools usage

The `bash`, `edit`, `glob`, `grep`, `read`, and `write` tools have specific restrictions listed in `~/ai-harness/SECURITY.md`.
- Read this file before using them.
- Always use an **allowed** command when possible to avoid asking for the user validation.
  Especially, if you need to run a bash command that is not **allowed** by default, run it inside a docker container.
  **WARNING**: you may create files not owned by the current user - make sure to not lock yourself!
- Whatever the mode, when running `bash` commands, avoid shell expansions and variables as they require the user's validation to work.
- Whatever the mode, when running `bash`, fill its `description` with what the command does and why you need it.
