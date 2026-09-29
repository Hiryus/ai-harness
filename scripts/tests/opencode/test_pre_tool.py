# pytest is a test-only dependency and is not resolved by the linters.
# pyright: reportMissingImports=false
# ty: ignore[unresolved-import]

"""
The opencode requests, from the plugin payload to the verdict. The rules themselves are tested in `agnostic/`.
"""

import json
from pathlib import Path

import pytest

from opencode.pre_tool import glob_root, main

ROOT = "/proj"
FAKE_HOME = "/home/fakeuser"

# ============================================================================
# Helpers
# ============================================================================

def tool(name:str, tool_input:dict, mode="manual", directory=ROOT) -> dict:
    return json.loads(main({"kind": "tool", "tool": name, "input": tool_input, "directory": directory, "mode": mode}))

def permission(action:str, resources:list[str], mode="manual", directory=ROOT) -> dict:
    return json.loads(main({"kind": "permission", "action": action, "resources": resources, "directory": directory, "mode": mode}))

def bash(command:str, description="List the project files", **kwargs) -> str:
    tool_input = {"command": command} if description is None else {"command": command, "description": description}
    return tool("bash", tool_input, **kwargs)["verdict"]

# ============================================================================
# Context
# ============================================================================

@pytest.mark.parametrize("directory", ["", None])
def test_missing_directory_denied(directory):
    assert tool("read", {"path": "/proj/main.py"}, directory=directory)["verdict"] == "deny"

def test_unknown_request_kind_denied():
    assert json.loads(main({"kind": "other", "directory": ROOT}))["verdict"] == "deny"

@pytest.mark.parametrize("mode", [None, "", "config"])
def test_an_unknown_mode_is_manual(mode):
    assert tool("write", {"path": "/proj/main.py"}, mode=mode)["verdict"] == "ask"

# ============================================================================
# Shell
# ============================================================================

def test_bash_is_analyzed():
    assert bash("ls") == "allow"
    assert bash("cat .env") == "deny"
    assert bash("curl https://example.com") == "ask"

@pytest.mark.parametrize("description", [None, "", "  "])
def test_bash_without_intent_denied(description):
    # Rule 2.2: the `bash` tool carries a `description`, the native `shell` does not.
    assert bash("ls", description=description) == "deny"

def test_bash_without_command_denied():
    assert tool("bash", {"description": "nothing"})["verdict"] == "deny"

def test_bash_unparseable_command_denied():
    assert bash("echo 'unterminated") == "deny"

def test_bash_cd_with_other_commands_denied():
    # Rule 2.3: also what makes opencode's own `cd` handling irrelevant.
    assert bash("cd /tmp && cat notes.txt") == "deny"

def test_bash_workdir_anchors_relative_paths():
    assert tool("bash", {"command": "cat notes.txt", "description": "Read notes", "workdir": "sub"})["verdict"] == "allow"
    assert tool("bash", {"command": "cat notes.txt", "description": "Read notes", "workdir": "/elsewhere"})["verdict"] == "ask"

def test_bash_ask_becomes_deny_in_auto_mode():
    assert bash("curl https://example.com", mode="auto") == "deny"

@pytest.mark.parametrize(("name", "tool_input"), [
    ("shell", {"command": "ls"}),
    ("execute", {"code": "return 1"}),
    ("question", {"prompt": "?"}),
])
def test_forbidden_tools_denied(name, tool_input):
    assert tool(name, tool_input, mode="edit")["verdict"] == "deny"

# ============================================================================
# Files
# ============================================================================

def test_read_follows_the_file_rules():
    assert tool("read", {"path": "main.py"})["verdict"] == "allow"
    assert tool("read", {"path": "/proj/.env"})["verdict"] == "deny"
    assert tool("read", {"path": "/elsewhere/notes.txt"})["verdict"] == "ask"

@pytest.mark.parametrize("name", ["edit", "write"])
def test_writes_follow_the_mode(name):
    assert tool(name, {"path": "/proj/main.py"})["verdict"] == "ask"
    assert tool(name, {"path": "/proj/main.py"}, mode="edit")["verdict"] == "allow"
    assert tool(name, {"path": "/proj/.git/config"}, mode="edit")["verdict"] == "deny"

@pytest.mark.parametrize("name", ["read", "edit", "write"])
def test_missing_path_denied(name):
    assert tool(name, {})["verdict"] == "deny"

def test_tmp_is_allowed_despite_opencode_asking_for_external_directories():
    assert tool("write", {"path": "/tmp/scratch.txt"}, mode="edit")["verdict"] == "allow"

def test_grep_checks_the_path_not_the_pattern():
    assert tool("grep", {"pattern": ".env", "path": "src"})["verdict"] == "allow"
    assert tool("grep", {"pattern": "foo", "path": "/proj/.env"})["verdict"] == "deny"
    assert tool("grep", {"pattern": "foo", "path": "/elsewhere"})["verdict"] == "ask"

def test_grep_without_path_searches_the_project():
    assert tool("grep", {"pattern": "foo"})["verdict"] == "allow"

def test_grep_is_never_a_write():
    assert tool("grep", {"pattern": "foo", "path": "src"}, mode="manual")["verdict"] == "allow"

@pytest.mark.parametrize(("pattern", "root"), [
    ("**/*.md", ""),
    ("src/*.py", "src"),
    ("../other/**/*.md", "../other"),
    ("/home/user/.ssh/*", "/home/user/.ssh"),
    ("docs/readme.md", "docs"),
])
def test_glob_root(pattern, root):
    assert glob_root(pattern) == root

def test_glob_checks_where_the_pattern_escapes():
    assert tool("glob", {"pattern": "**/*.md"})["verdict"] == "allow"
    assert tool("glob", {"pattern": "../other/**/*.md"})["verdict"] == "ask"
    assert tool("glob", {"pattern": "*", "path": "/elsewhere"})["verdict"] == "ask"
    assert tool("glob", {"pattern": "/root/.ssh/*"})["verdict"] == "deny"

# ============================================================================
# Other tools
# ============================================================================

def test_webfetch_allows_web_pages_only():
    assert tool("webfetch", {"url": "https://opencode.ai/docs"})["verdict"] == "allow"
    assert tool("webfetch", {"url": "file:///etc/passwd"})["verdict"] == "ask"

@pytest.mark.parametrize("name", ["skill", "subagent", "websearch"])
def test_harmless_tools_allowed(name):
    assert tool(name, {})["verdict"] == "allow"

def test_unknown_tools_ask_then_deny_in_auto_mode():
    assert tool("github_create_issue", {})["verdict"] == "ask"
    assert tool("github_create_issue", {}, mode="auto")["verdict"] == "deny"

# ============================================================================
# Permission requests (tools deciding on their resources, like `patch`)
# ============================================================================

def test_edit_permission_checks_every_resource():
    assert permission("edit", ["/proj/a.py", "/proj/b.py"], mode="edit")["verdict"] == "allow"
    assert permission("edit", ["/proj/a.py", "/proj/.env"], mode="edit")["verdict"] == "deny"
    assert permission("edit", ["/proj/a.py", "/elsewhere/b.py"], mode="edit")["verdict"] == "ask"

def test_read_permission_resources_are_relative_to_the_project():
    assert permission("read", ["README.md"])["verdict"] == "allow"

def test_empty_resources_denied():
    assert permission("edit", [])["verdict"] == "deny"

def test_unknown_permission_asks_then_denies_in_auto_mode():
    assert permission("external_directory", ["/elsewhere/*"])["verdict"] == "ask"
    assert permission("external_directory", ["/elsewhere/*"], mode="auto")["verdict"] == "deny"

# ============================================================================
# Harness protection (rules 1.1 and 1.3)
# ============================================================================

def test_harness_plugins_are_not_writable_from_another_project(monkeypatch):
    monkeypatch.setenv("HOME", FAKE_HOME)
    plugin = str(Path(FAKE_HOME) / ".config" / "opencode" / "plugins" / "harness" / "index.ts")
    assert tool("write", {"path": plugin}, mode="edit")["verdict"] == "deny"
    assert tool("read", {"path": plugin})["verdict"] == "allow"

def test_opencode_credentials_denied(monkeypatch):
    monkeypatch.setenv("HOME", FAKE_HOME)
    auth = str(Path(FAKE_HOME) / ".local" / "share" / "opencode" / "auth.json")
    assert tool("read", {"path": auth})["verdict"] == "deny"

def test_project_plugins_are_not_writable():
    assert tool("write", {"path": "/proj/.opencode/plugins/evil.ts"}, mode="edit")["verdict"] == "deny"
