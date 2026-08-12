/**
 * Web-egress and agent-credential contract helpers for `.github/workflows/*`
 * (issues #645, #668).
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
 *
 * Which is why this file also exports the *other* half of the same finding
 * (#668): `agentWriteScopeInventory`. Since egress cannot be closed for a job
 * that can execute code — and any agent with `Edit` plus `bun run test` or
 * `make check` can execute code — the only structural remedy is to make sure
 * the job has nothing worth stealing. Two mechanisms decide what an agent's
 * shell can read, and only one of them is the `permissions:` block:
 *
 *  1. `claude-code-action`'s run step assigns `process.env.GITHUB_TOKEN` and
 *     `GH_TOKEN` before starting the agent, and configures git auth with the
 *     same value, so the resolved token is readable by every Bash tool call.
 *     `persist-credentials: false` does **not** leave the workspace token-free:
 *     at the pinned SHA `be7b93b`, `configureGitAuth()` unsets the
 *     `http.<server>/.extraheader` that `actions/checkout` writes and then runs
 *     `git remote set-url origin https://x-access-token:<token>@github.com/…`,
 *     so the resolved token lands back in `.git/config` regardless. Only the
 *     token's own scopes make that copy uninteresting.
 *  2. Which token gets resolved is decided by the action's `src/github/
 *     token.ts`: when the step passes no `github_token` input, it exchanges an
 *     OIDC assertion for a Claude GitHub **App** installation token whose
 *     permissions are hardcoded to `contents`/`pull_requests`/`issues: write`.
 *     That token is not bounded by the job's `permissions:` block at all — it
 *     is why this repo's bug-patrol PRs are authored by `app/claude`. A job
 *     with entirely read-only `permissions:` still hands its agent a
 *     push-capable token unless it passes `github_token` explicitly.
 *
 * The inventory therefore reports both, and the contract test asserts it for
 * exact equality: a job that gains a write scope *or* starts minting an app
 * token shows up and fails, and a job that gave both up (sentry-harness's
 * `fix-error`) cannot silently take them back.
 *
 * `readOnlyMintContradictions` is the rule the inventory cannot express (#689).
 * An enumeration catches a *change*; it cannot say which entries are wrong, so
 * `health-audit`'s audit job sat in it for weeks reviewed as "read-only" while
 * its agent held the write-capable app token. The invariant that would have
 * caught it on the day it was written is narrow and general: a job whose
 * `permissions:` block grants no repository write has declared itself
 * read-only, and mechanism 2 above silently contradicts that declaration, so
 * such a job must pass `github_token`. Jobs that hold write scopes are
 * untouched — `bug-patrol`, `feedback-distill` and `quality-regrade` push from
 * inside the agent on purpose, and this rule has nothing to say about them.
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

/**
 * `id-token: write` mints an OIDC assertion for an external identity provider;
 * it grants no write against this repository, so it is excluded from the
 * write-scope inventory. Every *other* scope counts — the deliberate direction,
 * because the first version of the egress check allow-listed three scopes it
 * judged "credentialed" and thereby skipped `actions: write` and `packages:
 * write` entirely. Excluding one well-understood scope by name is safe;
 * enumerating the ones that matter is not.
 */
const NON_REPO_WRITE_SCOPES = new Set(["id-token"]);

/** What token a job holds, from its `permissions:` block. */
export type JobCredential =
  /** No `permissions:` block — the job inherits the repository's default scopes. */
  | { kind: "inherited" }
  /**
   * The `permissions: write-all` string shorthand. Only the string form is
   * recognized, which is the only form Actions accepts: `write-all` is not a
   * legal *value* inside a scope map (`contents: write-all` is a schema error),
   * so there is nothing else to match.
   */
  | { kind: "write-all" }
  /** Declared scopes; `write` lists the repository-write ones it granted. */
  | { kind: "declared"; write: string[] };

/**
 * Scopes the Claude GitHub App token carries when the action mints its own.
 * Hardcoded upstream in `src/github/token.ts` (`DEFAULT_PERMISSIONS`), so no
 * `permissions:` block can narrow them.
 */
export const APP_TOKEN_SCOPES = ["contents", "issues", "pull-requests"] as const;

/** A job that runs the agent, with the argument strings each agent step got. */
export type AgentJob = {
  /** Job key as written under `jobs:`. */
  name: string;
  /** One entry per agent step in the job, in step order. */
  steps: { argStrings: string[]; bindsOwnToken: boolean }[];
  /** The token this job's steps (and therefore its agent) can read. */
  credential: JobCredential;
  /** True when an agent step lets the action mint a Claude App token. */
  mintsAppToken: boolean;
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

/** Read one job's `permissions:` block into a {@link JobCredential}. */
export function credentialOf(job: Record<string, unknown>): JobCredential {
  const permissions = job.permissions;
  if (permissions === undefined) return { kind: "inherited" };
  if (typeof permissions === "string") {
    return permissions.trim() === "write-all" ? { kind: "write-all" } : { kind: "declared", write: [] };
  }
  if (!isRecord(permissions)) return { kind: "declared", write: [] };
  const write = Object.entries(permissions)
    .filter(([scope, level]) => String(level).trim() === "write" && !NON_REPO_WRITE_SCOPES.has(scope))
    .map(([scope]) => scope)
    .sort();
  return { kind: "declared", write };
}

/** Whether the job's own `permissions:` block can write to the repository. */
export function holdsRepoWrite(credential: JobCredential): boolean {
  return credential.kind !== "declared" || credential.write.length > 0;
}

/** Whether anything the agent's shell can read is push-capable. */
export function agentHoldsWrite(job: AgentJob): boolean {
  return job.mintsAppToken || holdsRepoWrite(job.credential);
}

/** Human-readable summary of a credential, for the enumerated inventory. */
export function describeCredential(credential: JobCredential): string {
  if (credential.kind === "inherited") return "inherited (no permissions: block)";
  if (credential.kind === "write-all") return "write-all";
  return credential.write.join(", ");
}

/** Both credential sources, as one inventory line. */
export function describeAgentCredential(job: AgentJob): string {
  const parts: string[] = [];
  if (holdsRepoWrite(job.credential)) parts.push(describeCredential(job.credential));
  if (job.mintsAppToken) parts.push(`claude app token (${APP_TOKEN_SCOPES.join(", ")})`);
  return parts.join(" + ");
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
        const override = inputs.github_token;
        return {
          argStrings: ARG_INPUTS.map((input) => inputs[input]).filter(
            (value): value is string => typeof value === "string",
          ),
          // Any non-empty `github_token` takes token.ts's early return, so the
          // agent gets that token instead of a freshly minted app token.
          bindsOwnToken: typeof override === "string" && override.trim().length > 0,
        };
      });
    if (steps.length > 0) {
      agentJobs.push({
        name,
        steps,
        credential: credentialOf(job),
        mintsAppToken: steps.some((step) => !step.bindsOwnToken),
      });
    }
  }

  return agentJobs;
}

/**
 * `path (job: name): <credentials>` for every agent job whose shell can read a
 * push-capable token — from its own `permissions:` block, from the Claude App
 * token the action mints when no `github_token` is passed, or both. The
 * contract test asserts exact equality against the known set, so this is an
 * enumeration rather than a pass/fail rule: a job that gains either appears
 * here and fails the suite, and one that gave both up cannot take them back
 * unnoticed.
 *
 * ponytail: reads the `permissions:` block and the step's `github_token` input.
 * A PAT handed to a step through `env:` is a stronger credential that this
 * inventory does not see; the `docs/agents/ci.md` egress note carries that
 * caveat. Upgrade path is to fold a `secrets.*`-in-`env:` scan in here if that
 * pattern ever appears.
 */
export function agentWriteScopeInventory(path: string, contents: string): string[] {
  let jobs: AgentJob[];
  try {
    jobs = agentJobsOf(contents);
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return [`${path}: is not parseable YAML (${reason}), so credentials cannot be checked`];
  }

  return jobs
    .filter((job) => agentHoldsWrite(job))
    .map((job) => `${path} (job: ${job.name}): ${describeAgentCredential(job)}`);
}

/**
 * Whether the job's own `permissions:` block declares it read-only — an
 * explicit scope map with no repository-write entry. `id-token: write` does not
 * disqualify a job here (it is not a repository write), which is deliberate:
 * that shape — every scope `read` plus `id-token: write` — is *exactly* the
 * one this rule exists to catch, because the OIDC assertion is what makes the
 * app-token exchange possible. An absent `permissions:` block ("inherited") is
 * not a declaration of anything and is left to the inventory.
 */
export function declaresReadOnly(credential: JobCredential): boolean {
  return credential.kind === "declared" && credential.write.length === 0;
}

/**
 * `path (job: name)` violations of the read-only credential rule (#689): an
 * agent job whose `permissions:` block grants no repository write, but whose
 * agent step omits `github_token` and therefore hands its shell a Claude App
 * token with `contents`/`pull_requests`/`issues: write`.
 *
 * Unlike {@link agentWriteScopeInventory} this is a pass/fail rule, so it
 * applies to workflows nobody has enumerated yet — a new "read-only analysis
 * job" copied from an existing one fails here on the day it is written rather
 * than being added to a list of known exceptions.
 */
export function readOnlyMintContradictions(path: string, contents: string): string[] {
  let jobs: AgentJob[];
  try {
    jobs = agentJobsOf(contents);
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return [`${path}: is not parseable YAML (${reason}), so credentials cannot be checked`];
  }

  return jobs
    .filter((job) => declaresReadOnly(job.credential) && job.mintsAppToken)
    .map(
      (job) =>
        `${path} (job: ${job.name}): declares read-only permissions but its agent step passes no ` +
        `github_token, so claude-code-action mints a Claude App token (${APP_TOKEN_SCOPES.join(", ")}: write) ` +
        `that the permissions block cannot restrain`,
    );
}

const UNSCOPED_GH_API_GRANT = /^Bash\(gh api (?:-X|--method) GET:\*\)$/;

/**
 * `path (job: name): grant` for every `Bash(gh api ...)` a job's
 * `--allowedTools` grants without pinning the method to GET (issue #736).
 * `gh api` is a raw REST client — with the job's write-capable token
 * (a bound `github_token` or, absent one, the Claude App token
 * {@link readOnlyMintContradictions} tracks) an unscoped grant reaches the
 * PR-merge and Contents endpoints, defeating "never merge, never touch code"
 * prompts that are otherwise prose-only. Read-only reaches such as review-
 * comment listing only ever need `gh api -X GET`.
 */
export function unscopedGhApiGrants(path: string, contents: string): string[] {
  let jobs: AgentJob[];
  try {
    jobs = agentJobsOf(contents);
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return [`${path}: is not parseable YAML (${reason}), so gh api grants cannot be checked`];
  }

  return jobs.flatMap((job) => {
    const grants = toolsIn(
      job.steps.flatMap((step) => step.argStrings.flatMap((args) => flagValues(args, "allowedTools"))),
    ).filter((tool) => tool.startsWith("Bash(gh api"));

    return grants
      .filter((grant) => !UNSCOPED_GH_API_GRANT.test(grant))
      .map((grant) => `${path} (job: ${job.name}): grants ${grant} — scope it to GET`);
  });
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
