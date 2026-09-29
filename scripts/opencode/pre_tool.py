"""
Decision point for the opencode plugin (`opencode/plugins/harness/index.ts`), enforcing the security rules.

The plugin sends one JSON request on stdin and reads one `{"verdict", "reason"}` object back on stdout:
- `kind: "tool"` for every tool call, from the raw input the model sent (`tool.execute.before`),
- `kind: "permission"` for the permission requests of a tool whose raw input is not enough (`patch` lists the files it touches only there).
"""

import json
import os
import sys

from agnostic import file_access, shell
from agnostic.generic import check_mode_rules, worst
from agnostic.models.context import Context
from agnostic.models.decision import Decision
from agnostic.models.parsing import Access, ContextError, ParseError
from opencode.utils.context import context_of

ALLOWED_TOOLS = ["skill", "subagent", "todowrite", "websearch"]

# ============================================================================
# Tool calls
# ============================================================================

def glob_root(pattern:str) -> str:
    """
    The literal directory a glob pattern starts from: `../other/**/*.md` searches `../other`, `**/*.md` the search path itself.
    """
    index = next((i for i, char in enumerate(pattern) if char in "*?[{"), len(pattern))
    return os.path.dirname(pattern[:index])

def decide_files(paths:list[str], access:Access, context:Context) -> Decision:
    if not paths or not all(paths):
        # An empty path would resolve to the current directory, not to what the tool opens.
        return Decision.deny("No path given.")
    return worst(*(file_access.analyze(file_path=path, access=access, context=context) for path in paths))

def decide_tool(tool:str, tool_input:dict, context:Context) -> Decision:
    match tool:
        case "bash":
            command = tool_input.get("command")
            if not isinstance(command, str) or not command.strip():
                return Decision.deny("No `command` given.")
            return shell.analyze(command, context)
        case "shell":
            return Decision.deny("Tool `shell` is not allowed. Use the `bash` tool instead, with a meaningful `description`.")
        case "execute":
            return Decision.deny("Code Mode is not allowed: it runs arbitrary code on the host. Call the tools directly.")
        case "question":
            return Decision.deny("Tool `question` is not allowed. Ask your question in your answer instead.")
        case "read":
            return decide_files([tool_input.get("path") or ""], Access.READ, context)
        case "edit" | "write":
            return decide_files([tool_input.get("path") or ""], Access.WRITE, context)
        case "grep":
            return decide_files([tool_input.get("path") or "."], Access.READ, context)
        case "glob":
            path = tool_input.get("path") or "."
            root = os.path.join(path, glob_root(str(tool_input.get("pattern") or "")))
            return decide_files([path, root], Access.READ, context)
        case "webfetch":
            url = str(tool_input.get("url") or "")
            if url.startswith(("http://", "https://")):
                return Decision.allow("Fetching a web page is allowed.")
            return check_mode_rules(Decision.ask(f"Fetching `{url}` is not a web page."), context)
        case _ if tool in ALLOWED_TOOLS:
            return Decision.allow(f"Tool `{tool}` is allowed.")
        case _:
            return check_mode_rules(Decision.ask(f"Tool `{tool}` is not in the allow-list."), context)

# ============================================================================
# Permission requests
# ============================================================================

def decide_permission(action:str, resources:list[str], context:Context) -> Decision:
    match action:
        case "read":
            return decide_files(resources, Access.READ, context)
        case "edit":
            return decide_files(resources, Access.WRITE, context)
        case _:
            return check_mode_rules(Decision.ask(f"Permission `{action}` is not in the allow-list."), context)

# ============================================================================
# Hook I/O
# ============================================================================

def format_response(decision:Decision) -> str:
    return json.dumps({"verdict": decision.verdict.value, "reason": decision.reason})

def main(input_data:dict) -> str:
    try:
        context = context_of(input_data)
        match input_data.get("kind"):
            case "tool":
                return format_response(decide_tool(str(input_data.get("tool") or ""), input_data.get("input") or {}, context))
            case "permission":
                resources = [str(resource) for resource in input_data.get("resources") or []]
                return format_response(decide_permission(str(input_data.get("action") or ""), resources, context))
            case kind:
                return format_response(Decision.deny(f"Unknown request kind `{kind}`."))
    except ContextError as err:
        return format_response(Decision.deny(f"invalid tool context: {err}"))
    except ParseError as err:
        return format_response(Decision.deny(f"Refusing to run an unparseable command: {err}"))


if __name__ == "__main__":
    try:
        input_data:dict = json.loads(sys.stdin.read())
        print(main(input_data))
    except Exception as err: # noqa: BLE001
        print(format_response(Decision.deny(f"Hook error, denying for safety: {err}")))
