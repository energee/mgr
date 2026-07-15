/**
 * Deterministic publisher for schema-validated scheduled health-audit output.
 * The AI audit job is read-only; this process alone receives issue write
 * permission, rechecks duplicates and labels, and verifies every created issue.
 */

import { appendFileSync, readFileSync, realpathSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, sep } from "node:path";
import {
  buildPublicationPlan,
  findDuplicateIssue,
  parseAuditReport,
  type ExistingIssue,
} from "./health-audit/issues";

type GitHubApiIssue = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  pull_request?: unknown;
};

type GitHubIssueView = {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  labels: Array<{ name: string }>;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required");
  return value;
}

function runGitHub(args: string[]): string {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
  }).trim();
}

function listAllIssues(repository: string): ExistingIssue[] {
  const output = runGitHub([
    "api",
    "--paginate",
    "--slurp",
    "repos/" + repository + "/issues?state=all&per_page=100",
  ]);
  const pages = JSON.parse(output) as unknown;
  if (!Array.isArray(pages)) throw new Error("GitHub issue response must be an array");
  const records = pages.flatMap((page) => {
    if (!Array.isArray(page)) throw new Error("GitHub issue response page must be an array");
    return page as GitHubApiIssue[];
  });

  return records
    .filter((issue) => issue.pull_request === undefined)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body ?? "",
      state: issue.state,
      url: issue.html_url,
    }));
}

function listLabels(): Set<string> {
  const labels = JSON.parse(
    runGitHub(["label", "list", "--limit", "1000", "--json", "name"]),
  ) as Array<{ name: string }>;
  return new Set(labels.map((label) => label.name));
}

function validateEvidenceLocations(report: ReturnType<typeof parseAuditReport>): void {
  const root = realpathSync(process.cwd());
  for (const finding of report.findings) {
    for (const evidence of finding.evidence) {
      let path: string;
      try {
        path = realpathSync(resolve(root, evidence.path));
      } catch {
        throw new Error("evidence file does not exist: " + evidence.path);
      }
      if (path !== root && !path.startsWith(root + sep)) {
        throw new Error("evidence path escapes the repository: " + evidence.path);
      }
      if (!statSync(path).isFile()) {
        throw new Error("evidence path is not a file: " + evidence.path);
      }
      const lineCount = readFileSync(path, "utf8").split(/\r?\n/).length;
      if (evidence.line > lineCount) {
        throw new Error(
          "evidence line is outside " + evidence.path + ":" + lineCount,
        );
      }
    }
  }
}

function createAndVerifyIssue(
  title: string,
  body: string,
  labels: string[],
): GitHubIssueView {
  const args = ["issue", "create", "--title", title, "--body", body];
  for (const label of labels) args.push("--label", label);
  const url = runGitHub(args);
  const numberMatch = url.match(/\/issues\/(\d+)\/?$/);
  if (!numberMatch) throw new Error("could not determine created issue number from " + url);

  const issue = JSON.parse(
    runGitHub([
      "issue",
      "view",
      numberMatch[1],
      "--json",
      "number,title,body,state,url,labels",
    ]),
  ) as GitHubIssueView;
  const actualLabels = new Set(issue.labels.map((label) => label.name));
  if (
    issue.title !== title ||
    issue.body !== body ||
    labels.some((label) => !actualLabels.has(label))
  ) {
    throw new Error("created issue #" + issue.number + " failed read-back verification");
  }
  return issue;
}

function appendSummary(lines: string[]): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, lines.join("\n") + "\n", "utf8");
}

function main(): void {
  const report = parseAuditReport(requiredEnvironment("HEALTH_AUDIT_REPORT"));
  const repository = requiredEnvironment("GITHUB_REPOSITORY");
  const commitSha = requiredEnvironment("AUDIT_COMMIT_SHA");
  const runUrl = requiredEnvironment("AUDIT_RUN_URL");
  const expectedFocus = requiredEnvironment("AUDIT_FOCUS");
  const createIssues = process.env.CREATE_ISSUES === "true";
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) {
    throw new Error("AUDIT_COMMIT_SHA must be a full Git commit SHA");
  }
  if (report.focus !== expectedFocus) {
    throw new Error("health-audit output focus does not match the scheduled focus");
  }
  validateEvidenceLocations(report);
  const plan = buildPublicationPlan(
    report,
    listAllIssues(repository),
    listLabels(),
    { commitSha, runUrl },
  );

  const summary = [
    "# Scheduled health audit",
    "",
    "**Focus:** " + report.focus,
    "",
    report.executiveVerdict,
    "",
    "Confirmed findings: " + report.findings.length,
    "",
  ];

  for (const duplicate of plan.duplicates) {
    summary.push(
      "- Skipped duplicate: " +
        duplicate.finding.title +
        " ([#" +
        duplicate.issue.number +
        "](" +
        duplicate.issue.url +
        "))",
    );
  }

  const created: GitHubIssueView[] = [];
  const duplicateNumbers = plan.duplicates.map((item) => item.issue.number);
  for (const pending of plan.pending) {
    if (!createIssues) {
      summary.push("- Dry run — would create: " + pending.title);
      continue;
    }
    const lastMinuteDuplicate = findDuplicateIssue(
      pending.finding,
      listAllIssues(repository),
    );
    if (lastMinuteDuplicate) {
      duplicateNumbers.push(lastMinuteDuplicate.number);
      summary.push(
        "- Skipped duplicate found immediately before creation: [#" +
          lastMinuteDuplicate.number +
          "](" +
          lastMinuteDuplicate.url +
          ")",
      );
      continue;
    }
    const issue = createAndVerifyIssue(pending.title, pending.body, pending.labels);
    created.push(issue);
    summary.push("- Created: [#" + issue.number + "](" + issue.url + ") " + issue.title);
  }

  if (plan.pending.length === 0 && plan.duplicates.length === 0) {
    summary.push("- No confirmed new findings.");
  }
  summary.push(
    "",
    "Investigated but rejected: " + report.investigatedButRejected.length,
    "",
    "Notable strengths: " + report.notableStrengths.length,
  );
  appendSummary(summary);

  process.stdout.write(
    JSON.stringify(
      {
        createIssues,
        created: created.map((issue) => ({ number: issue.number, url: issue.url })),
        duplicates: duplicateNumbers,
        pending: createIssues ? 0 : plan.pending.length,
      },
      null,
      2,
    ) + "\n",
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write("health-audit publisher failed: " + message + "\n");
  process.exitCode = 1;
}
