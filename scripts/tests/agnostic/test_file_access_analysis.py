# pytest is a test-only dependency and is not resolved by the linters.
# pyright: reportMissingImports=false
# ty: ignore[unresolved-import]

"""
The file rules, exercised straight from a plain `Context`: no payload, no session file, no `~/.claude`.
"""

from pathlib import Path

import pytest

from agnostic.file_access import analyze
from agnostic.models.context import Context
from agnostic.models.decision import Verdict
from agnostic.models.mode import Mode
from agnostic.models.parsing import Access
from agnostic.utils.filesystem import harness_roots

PROJECT = Path("/proj")
HARNESS = Path("/opt/some-harness")


SHARED = Path("/opt/shared-harness")


def context(mode=Mode.MANUAL, project_root=PROJECT) -> Context:
    return Context(current_cwd=project_root, harness_roots=[HARNESS, SHARED], mode=mode, project_root=project_root)

def verdict(file_path:str, access:Access, **kwargs) -> Verdict:
    return analyze(file_path, access, context(**kwargs)).verdict

def test_read_in_project_is_allowed():
    assert verdict("/proj/main.py", Access.READ) is Verdict.ALLOW

@pytest.mark.parametrize(("mode", "expected"), [(Mode.MANUAL, Verdict.ASK), (Mode.EDIT, Verdict.ALLOW), (Mode.AUTO, Verdict.ALLOW)])
def test_write_in_project_follows_mode(mode, expected):
    assert verdict("/proj/main.py", Access.WRITE, mode=mode) is expected

def test_secret_is_denied_whatever_the_access():
    assert verdict("/proj/.env", Access.READ) is Verdict.DENY
    assert verdict("/proj/.env", Access.WRITE, mode=Mode.EDIT) is Verdict.DENY

def test_harness_root_comes_from_the_context():
    assert verdict("/opt/some-harness/settings.json", Access.READ) is Verdict.ALLOW
    assert verdict("/opt/some-harness/settings.json", Access.WRITE, mode=Mode.EDIT) is Verdict.DENY

def test_every_harness_root_is_protected():
    assert verdict("/opt/shared-harness/scripts/hook.py", Access.READ) is Verdict.ALLOW
    assert verdict("/opt/shared-harness/scripts/hook.py", Access.WRITE, mode=Mode.EDIT) is Verdict.DENY

def test_harness_as_project_is_writable():
    assert verdict("/opt/some-harness/settings.json", Access.WRITE, mode=Mode.EDIT, project_root=HARNESS) is Verdict.ALLOW

def test_outside_project_asks():
    assert verdict("/etc/hosts", Access.READ) is Verdict.ASK

def test_auto_mode_turns_ask_into_deny_and_points_to_the_harness_rules():
    decision = analyze("/etc/hosts", Access.READ, context(mode=Mode.AUTO))
    assert decision.verdict is Verdict.DENY
    assert "~/ai-harness/SECURITY.md" in decision.reason
    assert "/etc/hosts" in decision.reason

# ============================================================================
# Harness credentials named too generically to be matched by name (rule 1.1)
# ============================================================================

@pytest.mark.parametrize("relative", [".local/share/opencode/auth.json", ".local/share/opencode/mcp-auth.json", ".config/opencode/service.json"])
def test_opencode_credentials_are_denied(monkeypatch, tmp_path, relative):
    monkeypatch.setenv("HOME", str(tmp_path))
    assert verdict(str(tmp_path / relative), Access.READ) is Verdict.DENY

def test_opencode_credentials_are_matched_through_the_config_symlink(monkeypatch, tmp_path):
    # `~/.config/opencode` links to the harness repository: the resolved path is a secret too.
    repository = tmp_path / "ai-harness" / "opencode"
    repository.mkdir(parents=True)
    (tmp_path / ".config").mkdir()
    (tmp_path / ".config" / "opencode").symlink_to(repository)
    monkeypatch.setenv("HOME", str(tmp_path))
    assert verdict(str(repository / "service.json"), Access.READ) is Verdict.DENY

def test_opencode_sessions_state_is_a_harness_directory(monkeypatch):
    # The session mode lives there: only the user switches it. The home is outside `/tmp`, whose reads are allowed anyway.
    monkeypatch.setenv("HOME", "/home/fakeuser")
    state = "/home/fakeuser/.local/share/opencode/opencode.db"
    roots = harness_roots()
    assert analyze(state, Access.WRITE, Context(current_cwd=PROJECT, harness_roots=roots, mode=Mode.EDIT, project_root=PROJECT)).verdict is Verdict.DENY
    assert analyze(state, Access.READ, Context(current_cwd=PROJECT, harness_roots=roots, mode=Mode.MANUAL, project_root=PROJECT)).verdict is Verdict.ALLOW

def test_a_project_auth_json_is_not_a_credential():
    assert verdict("/proj/src/auth.json", Access.READ) is Verdict.ALLOW

# ============================================================================
# Project-level harness configuration (rule 1.3)
# ============================================================================

@pytest.mark.parametrize("file_path", [
    "/proj/.claude/settings.json",
    "/proj/.claude/hooks/hook.py",
    "/proj/.opencode/plugins/plugin.ts",
    "/proj/opencode.json",
    "/proj/opencode.jsonc",
    "/proj/.mcp.json",
])
def test_project_harness_config_write_is_denied(file_path):
    assert verdict(file_path, Access.WRITE, mode=Mode.EDIT) is Verdict.DENY

def test_project_harness_config_read_is_allowed():
    assert verdict("/proj/.claude/settings.json", Access.READ) is Verdict.ALLOW

@pytest.mark.parametrize("file_path", ["/proj/sub/opencode.json", "/proj/docs/.mcp.json", "/proj/claude/settings.json"])
def test_only_the_config_the_harness_loads_is_protected(file_path):
    assert verdict(file_path, Access.WRITE, mode=Mode.EDIT) is Verdict.ALLOW

def test_project_harness_config_is_writable_when_the_project_is_the_harness():
    assert verdict("/opt/some-harness/.opencode/plugins/plugin.ts", Access.WRITE, mode=Mode.EDIT, project_root=HARNESS) is Verdict.ALLOW
