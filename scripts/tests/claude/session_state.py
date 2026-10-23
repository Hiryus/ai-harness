"""
Test helper writing the per-session mode, as the `harness-mode` mod does (`claude/mods/mode/hooks/register.ts`).
The harness itself only reads the file (`claude.utils.session`): the writer lives in the mod.
"""

import json

from claude.utils.session import state_file


def write_mode(session_id:str, mode:str) -> None:
    """
    Record the mode of one session.
    The other keys of the file, if any, are kept to allow further information recording.
    """
    # Ensure the folder exists
    path = state_file(session_id)
    if path is None:
        raise ValueError(f"unusable session id: {session_id!r}")
    path.parent.mkdir(parents=True, exist_ok=True)
    # Read the current file
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    if not isinstance(state, dict):
        state = {}
    # Add the information and write the file
    state["mode"] = mode
    with open(path, "w", encoding="utf-8") as file:
        json.dump(state, file, indent=2)
