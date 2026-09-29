// Enforces the rules of `~/ai-harness/SECURITY.md` on every opencode tool call.
// The decisions are taken by the python policy shared with other harnesses: this plugin only routes the calls.
// - `tool.execute.before` sends every call with its raw input to the policy, and caches the verdict by call id.
//   A deny throws. An ask throws too for the tools that never request a permission, since nobody would be asked.
// - `permission.evaluate` applies the cached verdict to every permission request of the call (opencode's own asks included).
// - The native `shell` tool is replaced by a `bash` tool carrying a `description` (rule 2.2), Code Mode is removed.
// - The session mode is read from the metadata of the root session, written by `/mode` (cf. `tui.ts`).

import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import type { CommandEditor, CommandInvocation } from "@opencode/plugin/promise/command"
import type { PermissionEvaluation } from "@opencode/plugin/promise/permission"
import type { SessionPrompt } from "@opencode/plugin/promise/session"
import type { ToolEditor } from "@opencode/plugin/promise/tool"
import { MODE_KEY, MODES, modeOf } from "./mode.ts"

// ============================================================================
// Constants
// ============================================================================

const MAX_PARENTS = 16
const SCRIPTS = join(homedir(), "ai-harness", "scripts")
const TIMEOUT = 30

// Tools whose raw input does not list the files they touch: decided on their permission requests instead.
const DEFERRED_TOOLS = ["patch", "apply_patch"]
// Tools known to request a permission, which is where an ask reaches the user (`bash` through the `shell` it delegates to).
// The tools the policy always allows (`skill`, `subagent`, `websearch`, ...) never get an ask: they are not listed.
const PERMISSION_TOOLS = ["bash", "edit", "glob", "grep", "read", "webfetch", "write", ...DEFERRED_TOOLS]

// ============================================================================
// Types
// ============================================================================

type Call = {
  asked: boolean;
  decision?: Promise<Decision>;
  location: Promise<Location>;
  tool: string;
}

type Decision = {
  reason: string;
  verdict: Verdict;
}

type Location = {
  directory: string;
  mode: string;
}

type Session = NonNullable<Awaited<ReturnType<Plugin.Context["session"]["get"]>>>

type SessionID = PermissionEvaluation["sessionID"]

type ToolEvent = {
  readonly id: string;
  readonly input: unknown;
  readonly sessionID: SessionID;
  readonly tool: string;
}

type Verdict = "allow" | "ask" | "deny"

// ============================================================================
// Policy
// ============================================================================

function decide(payload: object): Promise<Decision> {
  return new Promise((resolve) => {
    const deny = (reason: string) => resolve({ verdict: "deny", reason: `Hook error, denying for safety: ${reason}` })
    let stdout = ""
    const child = spawn("uv", ["run", "--quiet", "--directory", SCRIPTS, "python", "-m", "opencode.pre_tool"], {
      stdio: ["pipe", "pipe", "ignore"],
    })
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      deny(`no answer after ${TIMEOUT} seconds`)
    }, 1000 * TIMEOUT)
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stdin.on("error", (err) => deny(String(err)))
    child.on("error", (err) => {
      clearTimeout(timer)
      deny(String(err))
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      try {
        const result = JSON.parse(stdout)
        if (["allow", "ask", "deny"].includes(result.verdict) && typeof result.reason === "string") return resolve(result)
        deny(`unexpected answer: ${stdout}`)
      } catch (err) {
        deny(`exit code ${code}: ${err}`)
      }
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

// ============================================================================
// Session mode
// ============================================================================

// The mode is set on the session the user talks to: subagent sessions inherit it from their root.
// An unresolved root records no mode, so the session runs in manual mode.
async function rootOf(ctx: Plugin.Context, sessionID: SessionID): Promise<{ root?: Session; directory: string }> {
  let session = await ctx.session.get({ sessionID })
  const directory = session?.location?.directory ?? ""
  for (let depth = 0; session?.parentID; depth++) {
    if (depth >= MAX_PARENTS) return { directory }
    session = await ctx.session.get({ sessionID: session.parentID })
  }
  return { root: session ?? undefined, directory }
}

async function locate(ctx: Plugin.Context, sessionID: SessionID): Promise<Location> {
  try {
    const { root, directory } = await rootOf(ctx, sessionID)
    return { directory, mode: modeOf(root?.metadata) }
  } catch {
    return { directory: "", mode: "manual" }  // the policy denies a call without a directory
  }
}

// ============================================================================
// Enforcement hooks
// ============================================================================

async function checkTool(ctx: Plugin.Context, calls: Map<string, Call>, event: ToolEvent) {
  // Registered before any await: the permission requests of the call look it up.
  const call: Call = { tool: event.tool, location: locate(ctx, event.sessionID), asked: false }
  calls.set(`${event.sessionID}:${event.id}`, call)
  if (DEFERRED_TOOLS.includes(event.tool)) return
  call.decision = call.location.then((location) => decide({ kind: "tool", tool: event.tool, input: event.input, ...location }))
  const decision = await call.decision
  // The deny stays cached: should the throw not stop the call, its permission requests are denied too.
  if (decision.verdict === "deny") throw new Error(decision.reason)
  if (decision.verdict === "ask" && !PERMISSION_TOOLS.includes(event.tool)) {
    throw new Error(`${decision.reason}\nThis tool never asks for a validation: it is denied.`)
  }
}

async function checkPermission(ctx: Plugin.Context, calls: Map<string, Call>, event: PermissionEvaluation) {
  const call = event.source?.id ? calls.get(`${event.sessionID}:${event.source.id}`) : undefined
  let decision: Decision
  if (call?.decision) {
    decision = await call.decision
    // A call asks once: its other requests (an external directory, then the file) are covered by the same answer.
    if (decision.verdict === "ask" && call.asked) decision = { verdict: "allow", reason: "already validated" }
  } else if (call && event.action === "external_directory") {
    decision = { verdict: "allow", reason: "the file request that follows is checked" }
  } else {
    if (!call) console.warn(`[harness] permission request without a known tool call: ${event.action} ${JSON.stringify(event.resources)}`)
    const location = call ? await call.location : await locate(ctx, event.sessionID)
    decision = await decide({ kind: "permission", action: event.action, resources: event.resources, ...location })
  }
  if (call && decision.verdict === "ask") call.asked = true
  event.effect = decision.verdict
  if (decision.verdict !== "allow") event.message = decision.reason
}

async function closeTool(calls: Map<string, Call>, event: ToolEvent) {
  const key = `${event.sessionID}:${event.id}`
  const call = calls.get(key)
  calls.delete(key)
  if (call?.decision && (await call.decision).verdict === "ask" && !call.asked) {
    console.warn(`[harness] tool call ran without the validation it required: ${call.tool}`)
  }
}

// ============================================================================
// Conveniences
// ============================================================================

function replaceShell(editor: ToolEditor) {
  const shell = editor.get("shell")
  if (shell) {
    editor.add({
      name: "bash",
      description: `${shell.description} Always fill \`description\` with why the command is needed and what it does.`,
      input: {
        type: "object",
        properties: {
          background: { type: "boolean", description: "Run the command in the background." },
          command: { type: "string", description: "The command to execute." },
          description: { type: "string", description: "Why this command is needed and what it does, in one short sentence." },
          timeout: { type: "number", description: "The timeout in milliseconds." },
          workdir: { type: "string", description: "The working directory (defaults to the project directory)." },
        },
        required: ["command", "description"],
      },
      output: shell.output,
      options: { codemode: false },
      execute: async (input, context) => {
        // A JSON schema gives no static type to the input: it is the object described above.
        const { description: _intent, ...shellInput } = input as Record<string, unknown>
        return await shell.execute(shellInput, context)
      },
    })
    editor.remove("shell")
  }
  if (editor.get("execute")) editor.remove("execute")
}

// The fallback of the TUI `/mode`, should the TUI plugin fail to load: the command must never reach the model as a prompt.
// It answers nothing, since the only answer a server plugin can give is a session message, sent to the model with the next prompt.
function addModeCommand(ctx: Plugin.Context, editor: CommandEditor) {
  editor.add({
    name: "mode",
    description: "Set the session mode: manual, edit or auto.",
    execute: async ({ sessionID, prompt }: CommandInvocation) => {
      const name = String(prompt?.text ?? "").trim().toLowerCase()
      if (!MODES.includes(name)) return
      const { root } = await rootOf(ctx, sessionID)
      if (!root) return
      await ctx.session.update({ sessionID: root.id, metadata: { ...root.metadata, [MODE_KEY]: name } })
    },
  })
}

// The model learns the mode from the prompts: a note is appended to the first one, then whenever the mode changed since.
// The last announced mode is kept per session in the plugin storage: subagents have their own conversation to tell.
async function noteMode(ctx: Plugin.Context, event: SessionPrompt) {
  if (typeof event.prompt.text !== "string") return
  const { root } = await rootOf(ctx, event.sessionID).catch(() => ({ root: undefined }))
  const mode = modeOf(root?.metadata)
  const key = `announced/${event.sessionID}`
  if ((await ctx.storage.get(key).catch(() => undefined)) === mode) return
  event.prompt.text = `${event.prompt.text}\n\n**You are running in ${mode} mode.**`
  await ctx.storage.set(key, mode).catch(() => undefined)  // unrecorded, the note is only repeated
}

// A convenience that fails to register is only reported.
async function optional(failure: string, register: () => Promise<unknown>) {
  try {
    await register()
  } catch (err) {
    console.error(`[harness] ${failure}: ${err}`)
  }
}

// ============================================================================
// Plugin
// ============================================================================

export default {
  id: "harness",

  async setup(ctx: Plugin.Context) {
    const calls = new Map<string, Call>()

    // The enforcement hooks come first, uncaught: a failure in the conveniences below must not leave the calls unchecked.
    await ctx.tool.hook("execute.before", (event) => checkTool(ctx, calls, event))
    await ctx.permission.hook("evaluate", (event) => checkPermission(ctx, calls, event))
    await ctx.tool.hook("execute.after", (event) => closeTool(calls, event))

    await optional("cannot replace the shell tool (the policy still denies it)", () => ctx.tool.transform(replaceShell))
    await optional("cannot register the /mode command", () => ctx.command.transform((editor) => addModeCommand(ctx, editor)))
    await optional("cannot register the mode note", () => ctx.session.hook("prompt", (event) => noteMode(ctx, event)))
  },
} satisfies Plugin.Plugin
