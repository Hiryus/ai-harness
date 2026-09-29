Personal configuration and scripts for various AI harness.

## File structure

```
├─ claude/                     - the claude code directory (`~/.claude` links here), only the config is versioned
|  ├─ agents/                  - the agents definitions
|  ├─ scripts                  - symbolic link to ../scripts
|  ├─ skills                   - symbolic link to ../skills
|  ├─ CLAUDE.md                - the global agents instructions
|  └─ settings.json            - the claude code central configuration
├─ opencode/                   - the opencode directory (`~/.config/opencode` links here), only the config is versioned
|  ├─ plugins/harness/         - the harness plugin
|  |  ├─ index.ts              - the server part, routing every tool call to the hooks scripts
|  |  ├─ tui.ts                - the TUI part, handling the `/mode` command
|  |  └─ mode.ts               - the session mode record, shared by both parts
|  ├─ skills                   - symbolic link to ../skills
|  ├─ AGENTS.md                - the global agents instructions
|  ├─ opencode.json            - the opencode central configuration (permissions fallback when the plugin fails)
|  └─ package.json             - the plugin dev dependencies (types and type check only, cf. `tsconfig.json`)
├─ skills/                     - the skills definitions, shared by all harnesses
├─ scripts/                    - the hooks scripts (uv project, cf. `pyproject.toml`)
|  ├─ agnostic/                - the business rules, free of any provider or I/O concern
|  |  ├─ analyzers/            - the per-binary policy checks (docker, find, git, grep, readonly, sed)
|  |  ├─ models/               - the models shared by all the scripts (context, decision, mode, parsing, grammar)
|  |  ├─ parsers/              - the bash lexing and per-binary argument grammars
|  |  ├─ templates/            - the message templates used by the policy
|  |  ├─ utils/                - the pure helpers (filesystem paths, message formatting)
|  |  ├─ file_access.py        - the file access analysis
|  |  ├─ generic.py            - the command-agnostic policy (file rules, access checks, mode rules)
|  |  └─ shell.py              - the bash command analysis
|  ├─ claude/                  - the claude code adapters: payload parsing, hook responses, entry points
|  |  ├─ utils/                - the context factory, hook response and session storage
|  |  ├─ pre_file_access.py    - the hook to control and secure files access from the Read/Edit/Write tools
|  |  ├─ pre_shell.py          - the hook to control and secure bash calls
|  |  ├─ post_markdown.py      - the hook to post-process markdown table
|  |  ├─ user_prompt_submit.py - the hook handling the `/mode` command and the auto mode note
|  |  └─ statusline_command.py - the script rendering the status bar in claude code
|  ├─ opencode/                - the opencode adapters
|  |  ├─ utils/                - the context factory
|  |  └─ pre_tool.py           - the decision point of the opencode plugin, for every tool call
|  ├─ tests/                   - `agnostic/` tests the policy from a plain context, `claude/` and `opencode/` the payload to response
|  └─ pyproject.toml           - the python project definition and dependencies declaration
└─ SECURITY.md                 - the security rules specifications
```

## Installation

```sh
git clone https://github.com/Hiryus/ai-harness ~/ai-harness
ln -s ~/ai-harness/claude ~/.claude
ln -s ~/ai-harness/opencode ~/.config/opencode
```

The repository must be cloned in `~/ai-harness`: the hooks protect this path as a harness directory.

## Requirements

- The [uv command](https://docs.astral.sh/uv/getting-started/installation/) installed and in the PATH.

## Tests

- Run tests with `uv run --directory scripts pytest tests`.
- Check typings with `uvx ty check scripts`.
- Lint with `uvx ruff check scripts`.
- Lint the opencode plugin with `npx @biomejs/biome@2.5.14 lint opencode/plugins`.
- Check the opencode plugin typings with `npm install --prefix opencode && npm run --prefix opencode check`.

## How it works

### Claude Code

The claude configuration define several hooks, invoked as modules from `scripts/`
(`uv run --directory ~/.claude/scripts python -m claude.<hook>`):
- `claude/pre_file_access.py` fires before the `Edit|Read|Write|Grep` tool calls,
- `claude/pre_shell.py` fires before the `Bash` tool calls.
- `claude/user_prompt_submit.py` fires before all the user's prompts.

Any direct access to a file (via `Edit`, `Read`, `Write`, or `Grep`) is validated by the `pre_file_access.py` script and any bash command is validated by the `pre_shell.py` script implemented based on [specifications rules](SECURITY.md).

The `user_prompt_submit.py` hook has two purposes:
1. It intercepts the `/mode <manual|edit|auto>` slash command to set the mode of the current session (`/mode info`, or `/mode` alone, reports it). The prompt is stopped there and never reaches the model.
2. For any other prompt, it injects a system note into the context when the session runs in "auto" mode.
The mode is written under the `mode` key of `~/.claude/sessions/<session_id>.json` and is the only thing the tool hooks consult: the claude code permission mode is not used.
The `skills/mode/SKILL.md` file only registers the command name for the harness and carries no instruction. It is marked `disable-model-invocation` so the model cannot call it.

The `statusline_command.py` script is invoked by claude code to draw the status command line.
It injects the current mode (manual/edit/auto) and useful information like the current model, context size and usage.

### OpenCode

The server part of the `opencode/plugins/harness/` plugin (`index.ts`, v2 API) routes every tool call to `scripts/opencode/pre_tool.py` (`uv run --directory ~/ai-harness/scripts python -m opencode.pre_tool`, JSON on stdin and stdout):
- The `tool.execute.before` hook sends the raw input of each call, and caches the verdict by call id. A deny throws.
  An ask throws too for the tools that never request a permission (MCP ones included, for now): nobody would be asked.
- The `permission.evaluate` hook applies the cached verdict to every permission request of the call (opencode's own `external_directory` asks included). A call asks at most once.
  The `patch` tool is the exception: its raw input does not list the files it touches, so its `edit` requests are decided on their resources.
- The native `shell` tool is replaced by a `bash` tool carrying a `description` (cf. [SECURITY.md](SECURITY.md) §2.2), and Code Mode (`execute`) is removed.
- The mode is read from the `harness.mode` key of the root session metadata. Subagent sessions inherit it.

The TUI part (`tui.ts`) handles the `/mode <manual|edit|auto>` command (`/mode info`, or `/mode` alone, reports it):
- It writes the `harness.mode` metadata of the root session and answers with a toast, so nothing reaches the model.
  A session message (`ctx.session.synthetic`) would be sent to the model with the next prompt.
- On the home screen, no session exists yet: `/mode <name>` creates one with the mode in its metadata, and opens it.
- The command is registered by the plugins, not as a tool: the model cannot call it.
- The server plugin registers a silent `/mode` too, as a fallback should the TUI plugin fail to load.
- The mode is noted in the first prompt of each session, then in the prompts following a change (the last noted mode is kept in the plugin storage).

Any error (spawn, timeout, invalid answer) denies the call. If the plugin itself fails to load, `opencode.json` makes every action ask.

> Analyzing bash commands requires parsing them, which is not exactly easy and not 100% reliable due to the  complexity and commands updates. However, it a good compromise between security and usability. A full sandbox would be better, but would require to include git credentials in the sandbox and is not easy to integrate with claude code while keeping good interractivity with the user.
>
> The aura project will eventually solve this issue in a much cleaner way (more tools - fully sandboxed bash by design). Until then, the bash analysis for claude code is described below.

### Bash analysis

The analysis is done in three passes:
1. **Lexing** (`parsers/bash.py`) turns the bash prompt into `CommandLine(program, args[], assignments[], redirects[])` objects, one per command, each word a `Token` tagged with the shell expansions it is built from. Grammar only, no policy.
2. **Grammar** (`models/grammar.py`, `parsers/arguments.py`) pairs a `CommandLine`'s words against a binary's `CommandSyntax` table (aliases, flags, subcommands) into an `Invocation(cmd_parts[], arguments[])`. A binary with no table is still parsed, with every word an operand — this is not a fallback, it is what makes `--` safe by default. `find` is the documented exception: it is an expression grammar, not getopt, so it gets its own zone walker instead of a `CommandSyntax` table.
3. **Policy** (`analyzers/*.py`, `shell.py`) matches the `Invocation` against the [specification rules](SECURITY.md) to return a `Decision(verdict=ALLOW|ASK|DENY, reason=string)`. Each supported binary has its own `analyzers/*.py`; an unrecognised one is analyzed directly and usually asks for human validation.

## Useful links

- [Official Claude Code documentation for settings](https://code.claude.com/docs/en/settings#available-settings)
- [Claude Code — Complete settings.json Reference](https://gist.github.com/mculp/c082bd1e5a439410158974de90c89db7)
- [How To Kill The Bloat In Claude Code's System Prompt](https://www.aihero.dev/how-to-kill-the-bloat-in-claude-codes-system-prompt)
