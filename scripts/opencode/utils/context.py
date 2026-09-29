from pathlib import Path

from agnostic.models.context import Context
from agnostic.models.mode import Mode
from agnostic.models.parsing import ContextError
from agnostic.utils.filesystem import harness_roots


def context_of(input_data: dict) -> Context:
    """
    The ambient facts of one opencode call, as the plugin reports them.
    - `directory` is the session location: the project root, and the current directory unless the tool moves it (`workdir`).
    - `mode` is read by the plugin from the root session state: this side does no I/O.
    """
    directory:str|None = input_data.get("directory")
    if not directory:
        raise ContextError("the payload carries no `directory`")
    project_root = Path(directory).resolve()
    tool_input = input_data.get("input") or {}
    workdir = tool_input.get("workdir")
    return Context(
        current_cwd=(project_root / workdir).resolve() if isinstance(workdir, str) and workdir else project_root,
        harness_roots=harness_roots(),
        intent=str(tool_input.get("description") or ""),
        mode=Mode.of(input_data.get("mode")),
        project_root=project_root,
    )
