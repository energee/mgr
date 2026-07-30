/**
 * Web-egress contract helpers for `.github/workflows/*` (issue #645).
 *
 * Pure functions over workflow YAML *text*, so the contract in
 * `ci-workflows.test.ts` can be exercised against synthetic workflows as well
 * as the real files. That separation is the point: the first version of this
 * check hand-split workflow text on indentation and matched CLI flags with
 * quote-sensitive regexes, and it passed while checking *nothing* on several
 * valid-YAML shapes — `contents: "write"`, a job key with a trailing comment
 * or a YAML anchor, `permissions: write-all` — while rejecting a correct but
 * unquoted `--disallowedTools`. Parsing real YAML and tokenising the argument
 * string the way a shell would removes that whole class of hole; the synthetic
 * cases in the test file pin each shape that used to slip through.
 *
 * The rule enforced here is deliberately unconditional: *every* job that runs
 * `claude-code-action` must deny `WebFetch` and `WebSearch`. The earlier
 * version only checked jobs it judged "credentialed", and that judgement was
 * itself a hole — it counted only `contents`/`issues`/`pull-requests: write`,
 * so a job with `actions: write`, `packages: write`, or a PAT handed in via
 * `env:` (a *stronger* credential than `GITHUB_TOKEN`) was skipped entirely.
 * Dropping the branch removes the class of mistake rather than widening a
 * list. A job that genuinely needs the network opts out with a marker comment
 * naming it (`exemptionFor`), the same escape hatch as `durable-state: exempt`.
 *
 * What the rule buys, stated honestly: denying these two tools removes the
 * direct, single-call egress channel from an agent that reads
 * attacker-influenceable text. It does not make a credentialed job
 * exfiltration-proof — `Bash(git:*)` can push to an arbitrary remote,
 * `Bash(bun:*)` can `bun -e 'fetch(...)'`, and on a public repo
 * `gh issue create` is itself a publishing channel. See `docs/agents/ci.md`.
 */
import { parse } from "yaml";

/** Substring identifying a step that runs the generative agent. */
export const AGENT_ACTION = "anthropics/claude-code-action";

/** The two tools that give an agent a direct outbound network call. */
export const EGRESS_TOOLS = ["WebFetch", "WebSearch"] as const;

/**
 * `with:` inputs that carry CLI arguments — `claude_args` on claude-code-action
 * v1, plus the legacy v0 input names. `prompt` is deliberately excluded: prompt
 * text is attacker-influenceable in some jobs, and scanning it would let a
 * prompt that merely quotes `--disallowedTools "WebFetch,WebSearch"` satisfy
 * the contract. A step passing none of these declares nothing, which fails the
 * contract rather than skipping it.
 */
const ARG_INPUTS = ["claude_args", "allowed_tools", "disallowed_tools"] as const;

/** A job that runs the agent, with the argument strings each agent step got. */
export type AgentJob = {
  /** Job key as written under `jobs:`. */
  name: string;
  /** One entry per agent step in the job, in step order. */
  steps: { argStrings: string[] }[];
};

export type EgressAudit = {
  /** `path (job: name)` for every agent job the parse found. */
  jobs: string[];
  /** `path (job: name): rationale` for each job carrying an exemption marker. */
  exemptions: string[];
  /** Violations. Empty means the contract holds for this workflow. */
  problems: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Split a CLI argument string into tokens the way a shell would: double- and
 * single-quoted runs stay whole (so `--json-schema '{"a":1}'` survives), and
 * everything else splits on whitespace. Newlines are whitespace, so a YAML
 * block scalar (`claude_args: |`) tokenises the same as a one-liner.
 */
export function tokenizeArgs(args: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let match = pattern.exec(args); match !== null; match = pattern.exec(args)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

function stripQuotes(value: string): string {
  const quoted = value.match(/^(["'])([\s\S]*)\1$/);
  return quoted ? quoted[2] : value;
}

/** `--allowed-tools`, `--allowedTools` and `--allowedtools` name one flag. */
function normalizeFlag(name: string): string {
  return name.replace(/-/g, "").toLowerCase();
}

/**
 * Every value given to `flag` in `args`, independent of how it was written:
 * `--flag "a,b"`, `--flag 'a,b'`, `--flag a,b` and `--flag=a,b` all yield
 * `"a,b"`. The old regex required double quotes, so a legitimate unquoted
 * denial was reported as "passes no --disallowedTools".
 */
export function flagValues(args: string, flag: string): string[] {
  const wanted = normalizeFlag(flag);
  const tokens = tokenizeArgs(args);
  const values: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) continue;
    const separator = token.indexOf("=");
    const name = separator === -1 ? token.slice(2) : token.slice(2, separator);
    if (normalizeFlag(name) !== wanted) continue;
    values.push(
      stripQuotes(separator === -1 ? (tokens[index + 1] ?? "") : token.slice(separator + 1)),
    );
  }

  return values;
}

/** The individual tool names a comma-separated flag value lists. */
function toolsIn(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(","))
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
}

/** Every job in `contents` that runs at least one agent step. */
export function agentJobsOf(contents: string): AgentJob[] {
  const document: unknown = parse(contents);
  const jobs = isRecord(document) && isRecord(document.jobs) ? document.jobs : {};
  const agentJobs: AgentJob[] = [];

  for (const [name, job] of Object.entries(jobs)) {
    if (!isRecord(job) || !Array.isArray(job.steps)) continue;
    const steps = job.steps
      .filter(isRecord)
      .filter((step) => typeof step.uses === "string" && step.uses.includes(AGENT_ACTION))
      .map((step) => {
        const inputs = isRecord(step.with) ? step.with : {};
        return {
          argStrings: ARG_INPUTS.map((input) => inputs[input]).filter(
            (value): value is string => typeof value === "string",
          ),
        };
      });
    if (steps.length > 0) agentJobs.push({ name, steps });
  }

  return agentJobs;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A job may opt out of the denial with a comment that names it and says why:
 *
 *     # web-egress: allowed (job: docs-research) — reads vendor changelogs;
 *     #   no write scope and persist-credentials: false
 *
 * The rationale must be at least 20 characters on the marker line, so the
 * marker can't be dropped in as a bare silencer, and it must name the job, so a
 * multi-job workflow can't be exempted wholesale. Returns the rationale, or
 * null when the job has no marker.
 */
export function exemptionFor(contents: string, job: string): string | null {
  const marker = new RegExp(
    `web-egress:\\s*allowed\\s*\\(\\s*job:\\s*${escapeRegExp(job)}\\s*\\)\\s*[—:-]\\s*(\\S[^\\n]{19,})`,
  );
  return contents.match(marker)?.[1]?.trim() ?? null;
}

function egressProblems(where: string, job: AgentJob): string[] {
  const problems: string[] = [];

  job.steps.forEach((step, index) => {
    const at = job.steps.length > 1 ? `${where}, agent step ${index + 1}` : where;

    if (step.argStrings.length === 0) {
      problems.push(
        `${at}: runs the agent but passes no ${ARG_INPUTS.join("/")} input, so web egress is neither denied nor declared`,
      );
      return;
    }

    const denied = toolsIn(step.argStrings.flatMap((args) => flagValues(args, "disallowedTools")));
    const missing = EGRESS_TOOLS.filter((tool) => !denied.includes(tool));
    if (missing.length > 0) {
      problems.push(
        `${at}: --disallowedTools must name ${EGRESS_TOOLS.join(" and ")}; missing ${missing.join(", ")}` +
          (denied.length > 0 ? ` (denies: ${denied.join(", ")})` : " (no --disallowedTools at all)"),
      );
    }

    const allowed = toolsIn(step.argStrings.flatMap((args) => flagValues(args, "allowedTools")));
    const granted = EGRESS_TOOLS.filter((tool) => allowed.includes(tool));
    if (granted.length > 0) {
      problems.push(`${at}: --allowedTools must not grant ${granted.join(", ")}`);
    }
  });

  return problems;
}

/** Audit one workflow file's agent jobs against the egress contract. */
export function auditWorkflowEgress(path: string, contents: string): EgressAudit {
  let jobs: AgentJob[];
  try {
    jobs = agentJobsOf(contents);
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return {
      jobs: [],
      exemptions: [],
      problems: [`${path}: is not parseable YAML (${reason}), so the egress contract cannot be checked`],
    };
  }

  const audit: EgressAudit = { jobs: [], exemptions: [], problems: [] };

  // Anti-vacuity: a file that names the action but yields no agent job means
  // the parse missed it — exactly how the previous checker reported success
  // while checking nothing. Fail loudly instead of counting on a floor.
  if (contents.includes(AGENT_ACTION) && jobs.length === 0) {
    audit.problems.push(
      `${path}: names ${AGENT_ACTION} but no job parsed as running it, so nothing in this file was checked`,
    );
  }

  for (const job of jobs) {
    const where = `${path} (job: ${job.name})`;
    audit.jobs.push(where);
    const exemption = exemptionFor(contents, job.name);
    if (exemption) {
      audit.exemptions.push(`${where}: ${exemption}`);
      continue;
    }
    audit.problems.push(...egressProblems(where, job));
  }

  return audit;
}
