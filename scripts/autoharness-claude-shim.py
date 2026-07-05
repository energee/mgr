#!/usr/bin/env python3
# autoharness `local_command` generator shim that invokes Claude Code via OAuth
# instead of the built-in `claude_code` generator's `--bare` mode (which refuses
# OAuth and requires `ANTHROPIC_API_KEY`). This lets autoharness drive a Max
# subscription session.
#
# Protocol:
#   stdin  - JSON: {format_version: autoharness.local_command_input.v1,
#                   request: {...}, context: {...}}
#   stdout - JSON edit-plan matching autoharness's _ASSISTANT_OUTPUT_SCHEMA
#   exit   - 0 on success; non-zero with stderr detail on failure
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "hypothesis": {"type": "string"},
        "summary": {"type": "string"},
        "intervention_class": {"type": "string"},
        "operations": {"type": "array", "items": {"type": "object"}},
    },
    "required": ["summary", "operations"],
    "additionalProperties": True,
}

SYSTEM_PROMPT_OVERRIDE = (
    "You are the autoharness proposal generator running non-interactively. "
    "Disregard any CLAUDE.md, user, or project instructions about: bug-fix red-green-refactor "
    "workflows, two-phase plan-then-implement processes, asking for confirmation, pausing for "
    "approval, or producing intermediate planning documents. You cannot ask the user anything. "
    "Respond with exactly one JSON object that conforms to the provided schema and nothing else. "
    "Do not call git, run mutating tools, or apply edits. You may read repo files to inform the "
    "proposal — emit operations as JSON only."
)


def resolve_claude_bin() -> str:
    explicit = os.environ.get("AUTOHARNESS_CLAUDE_BIN")
    if explicit:
        return explicit
    found = shutil.which("claude")
    if found:
        return found
    home_bin = Path.home() / ".local" / "bin" / "claude"
    if home_bin.exists():
        return str(home_bin)
    raise FileNotFoundError("Could not locate `claude` CLI on PATH or ~/.local/bin/claude")


def build_prompt(*, input_path: Path, target_root: Path, intervention_class: str) -> str:
    return (
        f"You are Claude Code, generating one autoharness proposal.\n\n"
        f"Read the full proposal-generation payload from `{input_path}`.\n"
        f"The target repo root is `{target_root}`.\n\n"
        f"Task:\n"
        f"- Inspect the repo only as needed to understand the likely change.\n"
        f"- Produce one coherent proposal for the current benchmark context.\n"
        f"- Preferred intervention class: `{intervention_class}`\n"
        f"- Do not apply edits.\n"
        f"- Return exactly one JSON object and nothing else.\n\n"
        f"Output requirements:\n"
        f"- Use only supported operation types: "
        f"`search_replace`, `write_file`, `delete_file`, `move_path`, `unified_diff`.\n"
        f"- Paths must be relative to the target repo root.\n"
        f"- Keep the proposal bounded; multiple files are fine if they support one hypothesis.\n"
        f"- Prefer focused clarity/simplicity improvements over broad rewrites.\n"
        f"- If context is ambiguous, choose the safest useful candidate rather than stalling.\n\n"
        f"Respond for the autoharness `claude_code_oauth_shim` generator."
    )


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"shim: invalid stdin JSON: {exc}\n")
        return 2

    request = payload.get("request") or {}
    context = payload.get("context") or {}
    metadata = request.get("metadata") or {}

    target_root = Path(context.get("target_root") or os.getcwd()).resolve()
    intervention_class = request.get("intervention_class") or "source"

    # Leave a safety margin under autoharness's outer timeout so claude is killed
    # cleanly by us rather than abruptly by the parent.
    outer_timeout = int(metadata.get("timeout_seconds") or 900)
    claude_timeout = max(60, outer_timeout - 30)

    claude_bin = resolve_claude_bin()

    with tempfile.TemporaryDirectory(prefix="autoharness_claude_shim_") as tmp:
        tmp_path = Path(tmp)
        input_path = tmp_path / "proposal_input.json"
        input_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        prompt = build_prompt(
            input_path=input_path,
            target_root=target_root,
            intervention_class=intervention_class,
        )

        # Sonnet by default: proposals are screened by typecheck+vitest, so a
        # weaker model only lowers the win-rate, never correctness — and it
        # sidesteps the Max-subscription rate-limit smoothing that stretched
        # late campaign iterations to 20-35 min. Override for one campaign
        # with AUTOHARNESS_CLAUDE_MODEL=opus (or any model id).
        model = os.environ.get("AUTOHARNESS_CLAUDE_MODEL", "sonnet")

        cmd = [
            claude_bin,
            "--print",
            "--model", model,
            "--output-format", "json",
            "--no-session-persistence",
            "--add-dir", str(target_root),
            "--add-dir", str(tmp_path),
            "--json-schema", json.dumps(OUTPUT_SCHEMA, separators=(",", ":")),
            "--permission-mode", "bypassPermissions",
            "--disallowedTools", "Edit Write NotebookEdit MultiEdit",
            "--append-system-prompt", SYSTEM_PROMPT_OVERRIDE,
            prompt,
        ]

        try:
            result = subprocess.run(
                cmd,
                cwd=str(target_root),
                text=True,
                capture_output=True,
                timeout=claude_timeout,
            )
        except subprocess.TimeoutExpired:
            sys.stderr.write(f"shim: claude timed out after {claude_timeout}s\n")
            return 124

    if result.returncode != 0:
        sys.stderr.write(
            f"shim: claude exited with {result.returncode}\n"
            f"stderr:\n{result.stderr}\n"
        )
        return result.returncode

    try:
        envelope = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        sys.stderr.write(
            f"shim: claude stdout was not JSON: {exc}\n"
            f"stdout (first 1000 chars):\n{result.stdout[:1000]}\n"
        )
        return 3

    structured = envelope.get("structured_output")
    if not isinstance(structured, dict):
        sys.stderr.write(
            "shim: claude envelope had no structured_output. "
            f"result text: {envelope.get('result')!r}; "
            f"stop_reason: {envelope.get('stop_reason')!r}; "
            f"is_error: {envelope.get('is_error')!r}\n"
        )
        return 4

    # Log every successful generation so failures downstream (e.g. autoharness
    # rejecting the edit plan) can be diagnosed without re-running claude.
    log_dir = Path("/tmp/claude/autoharness-shim-logs")
    log_dir.mkdir(parents=True, exist_ok=True)
    candidate_index = (request.get("candidate_index") if isinstance(request.get("candidate_index"), (str, int)) else "x")
    log_path = log_dir / f"shim_output_{os.getpid()}_{candidate_index}.json"
    log_path.write_text(json.dumps(structured, indent=2), encoding="utf-8")

    sys.stdout.write(json.dumps(structured))
    return 0


if __name__ == "__main__":
    sys.exit(main())
