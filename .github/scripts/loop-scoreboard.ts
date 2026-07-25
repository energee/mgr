/**
 * Deterministic earns-its-cost scoreboard for the repo's agentic loops.
 *
 * Run by feedback-distill.yml before its agent step: tallies trailing-4-week
 * PR acceptance per loop label (opened / merged / closed-unmerged / open),
 * scheduled-run counts per workflow (runs with no PR ≈ quiet runs), and the
 * open needs-human backlog. Output is a markdown table written to the step
 * summary and to loop-scoreboard.md for the distill agent to interpret —
 * the deterministic step owns the numbers (publish-health-audit pattern).
 *
 * A loop whose PRs trend toward zero merges burns real API spend with no
 * signal; this table is the retain/revise/retire evidence for each loop.
 */

import { execFileSync } from "node:child_process";

const LOOKBACK_DAYS = 28;

const LOOPS = [
  { label: "bug-patrol", workflow: "bug-patrol.yml" },
  { label: "sentry-fix", workflow: "sentry-harness.yml" },
  { label: "feedback-distill", workflow: "feedback-distill.yml" },
  { label: "quality-regrade", workflow: "quality-regrade.yml" },
] as const;

type PullRecord = {
  created_at: string;
  merged_at: string | null;
  state: string;
  labels: Array<{ name: string }>;
};

export type LoopTally = {
  opened: number;
  merged: number;
  closedUnmerged: number;
  stillOpen: number;
};

export function bucketPulls(
  pulls: PullRecord[],
  sinceIso: string,
): Map<string, LoopTally> {
  const tallies = new Map<string, LoopTally>(
    LOOPS.map((loop) => [
      loop.label,
      { opened: 0, merged: 0, closedUnmerged: 0, stillOpen: 0 },
    ]),
  );
  for (const pull of pulls) {
    if (pull.created_at < sinceIso) continue;
    for (const { name } of pull.labels) {
      const tally = tallies.get(name);
      if (!tally) continue;
      tally.opened += 1;
      if (pull.merged_at) tally.merged += 1;
      else if (pull.state === "closed") tally.closedUnmerged += 1;
      else tally.stillOpen += 1;
    }
  }
  return tallies;
}

export function renderTable(
  tallies: Map<string, LoopTally>,
  runCounts: Map<string, number | null>,
  needsHumanOpen: number,
  sinceIso: string,
): string {
  const lines = [
    `## Loop scoreboard (since ${sinceIso.slice(0, 10)})`,
    "",
    "| Loop | Sched. runs | PRs opened | Merged | Closed unmerged | Still open |",
    "|---|---|---|---|---|---|",
  ];
  for (const loop of LOOPS) {
    const t = tallies.get(loop.label) ?? {
      opened: 0,
      merged: 0,
      closedUnmerged: 0,
      stillOpen: 0,
    };
    const runs = runCounts.get(loop.workflow);
    lines.push(
      `| ${loop.label} | ${runs ?? "–"} | ${t.opened} | ${t.merged} | ${t.closedUnmerged} | ${t.stillOpen} |`,
    );
  }
  lines.push(
    "",
    `Open needs-human issues: ${needsHumanOpen}`,
    "",
    "Runs with no PR are quiet runs — healthy when occasional, a retire/revise",
    "signal when a loop is all quiet or its merge rate trends toward zero.",
  );
  return lines.join("\n");
}

function gitHub(args: string[]): string {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env: process.env,
  }).trim();
}

function main(): void {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (!repository) throw new Error("GITHUB_REPOSITORY is required");
  const sinceIso = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const pages = JSON.parse(
    gitHub([
      "api",
      "--paginate",
      "--slurp",
      `repos/${repository}/pulls?state=all&sort=created&direction=desc&per_page=100`,
    ]),
  ) as PullRecord[][];
  const tallies = bucketPulls(pages.flat(), sinceIso);

  const runCounts = new Map<string, number | null>();
  for (const loop of LOOPS) {
    try {
      const count = gitHub([
        "api",
        `repos/${repository}/actions/workflows/${loop.workflow}/runs?created=%3E%3D${sinceIso.slice(0, 10)}&per_page=1`,
        "--jq",
        ".total_count",
      ]);
      runCounts.set(loop.workflow, Number(count));
    } catch {
      runCounts.set(loop.workflow, null); // workflow has no runs yet
    }
  }

  const needsHumanOpen = Number(
    gitHub([
      "api",
      `repos/${repository}/issues?labels=needs-human&state=open&per_page=100`,
      "--jq",
      "[.[] | select(has(\"pull_request\") | not)] | length",
    ]),
  );

  console.log(renderTable(tallies, runCounts, needsHumanOpen, sinceIso));
}

if (import.meta.main) main();
