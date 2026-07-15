/**
 * Validates structured health-audit output and builds deterministic GitHub
 * issue publication decisions. This module has no network or filesystem side
 * effects so the authorization boundary can be unit tested.
 */

export const auditSeverities = ["critical", "high", "medium"] as const;

export const auditIssueTypes = [
  "account-provisioning",
  "authorization",
  "data-lifecycle",
  "dependency-security",
  "deployment-drift",
  "dev-artifact",
  "documentation",
  "maintenance",
  "migration-drift",
  "production-runtime",
  "quality-gate",
  "silent-failure",
  "test-infrastructure",
  "transaction-integrity",
  "upstream-tooling",
] as const;

export type AuditSeverity = (typeof auditSeverities)[number];
export type AuditIssueType = (typeof auditIssueTypes)[number];

export type AuditEvidence = {
  path: string;
  line: number;
  explanation: string;
};

export type AuditFinding = {
  dedupeKey: string;
  title: string;
  severity: AuditSeverity;
  type: AuditIssueType;
  summary: string;
  rootCause: string;
  evidence: AuditEvidence[];
  impact: string;
  failureScenario: string;
  testsMiss: string;
  duplicateSearch: string;
  confidence: "high" | "medium";
  assumptions: string[];
  remediation: [string, string];
};

export type AuditReport = {
  executiveVerdict: string;
  focus: string;
  findings: AuditFinding[];
  investigatedButRejected: string[];
  notableStrengths: string[];
};

export type ExistingIssue = {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
};

export type PublicationMetadata = {
  commitSha: string;
  runUrl: string;
};

export type PendingIssue = {
  finding: AuditFinding;
  title: string;
  body: string;
  labels: string[];
};

export type PublicationPlan = {
  pending: PendingIssue[];
  duplicates: Array<{
    finding: AuditFinding;
    issue: ExistingIssue;
  }>;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " must be an object");
  }
  return value as JsonRecord;
}

function asString(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== "string") {
    throw new Error(label + " must be a string");
  }
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new Error(
      label + " must contain between " + minimum + " and " + maximum + " characters",
    );
  }
  return normalized;
}

function asStringArray(
  value: unknown,
  label: string,
  maximumItems: number,
): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(label + " must be an array with at most " + maximumItems + " items");
  }
  return value.map((item, index) =>
    asString(item, label + "[" + index + "]", 1, 2_000),
  );
}

function asEnum<T extends readonly string[]>(
  value: unknown,
  label: string,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(label + " must be one of: " + allowed.join(", "));
  }
  return value as T[number];
}

function validateEvidence(value: unknown, findingIndex: number): AuditEvidence[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    throw new Error(
      "findings[" + findingIndex + "].evidence must contain between 1 and 12 entries",
    );
  }

  return value.map((entry, evidenceIndex) => {
    const label =
      "findings[" + findingIndex + "].evidence[" + evidenceIndex + "]";
    const record = asRecord(entry, label);
    const path = asString(record.path, label + ".path", 1, 300);
    if (
      path.startsWith("/") ||
      path.includes("..") ||
      path.includes("\n") ||
      path.includes("\r")
    ) {
      throw new Error(label + ".path must be a repository-relative path");
    }
    if (!Number.isInteger(record.line) || Number(record.line) < 1) {
      throw new Error(label + ".line must be a positive integer");
    }
    return {
      path,
      line: Number(record.line),
      explanation: asString(record.explanation, label + ".explanation", 10, 2_000),
    };
  });
}

function validateFinding(value: unknown, index: number): AuditFinding {
  const label = "findings[" + index + "]";
  const record = asRecord(value, label);
  const dedupeKey = asString(record.dedupe_key, label + ".dedupe_key", 5, 100);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dedupeKey)) {
    throw new Error(label + ".dedupe_key must be lowercase kebab-case");
  }

  const title = asString(record.title, label + ".title", 12, 160);
  if (title.includes("\n") || title.includes("\r")) {
    throw new Error(label + ".title must be a single line");
  }

  if (!Array.isArray(record.remediation) || record.remediation.length !== 2) {
    throw new Error(label + ".remediation must contain exactly two approaches");
  }
  const remediation = record.remediation.map((item, remediationIndex) =>
    asString(item, label + ".remediation[" + remediationIndex + "]", 10, 3_000),
  ) as [string, string];

  return {
    dedupeKey,
    title,
    severity: asEnum(record.severity, label + ".severity", auditSeverities),
    type: asEnum(record.type, label + ".type", auditIssueTypes),
    summary: asString(record.summary, label + ".summary", 20, 3_000),
    rootCause: asString(record.root_cause, label + ".root_cause", 20, 5_000),
    evidence: validateEvidence(record.evidence, index),
    impact: asString(record.impact, label + ".impact", 20, 3_000),
    failureScenario: asString(
      record.failure_scenario,
      label + ".failure_scenario",
      20,
      4_000,
    ),
    testsMiss: asString(record.tests_miss, label + ".tests_miss", 20, 3_000),
    duplicateSearch: asString(
      record.duplicate_search,
      label + ".duplicate_search",
      10,
      2_000,
    ),
    confidence: asEnum(record.confidence, label + ".confidence", ["high", "medium"] as const),
    assumptions: asStringArray(record.assumptions, label + ".assumptions", 10),
    remediation,
  };
}

export function parseAuditReport(input: string): AuditReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("health-audit output is not valid JSON");
  }

  const record = asRecord(parsed, "health-audit output");
  if (!Array.isArray(record.findings) || record.findings.length > 8) {
    throw new Error("findings must be an array with at most 8 items");
  }

  const findings = record.findings.map(validateFinding);
  const dedupeKeys = new Set<string>();
  const normalizedTitles = new Set<string>();
  for (const finding of findings) {
    const normalizedTitle = normalizeIssueTitle(finding.title);
    if (dedupeKeys.has(finding.dedupeKey) || normalizedTitles.has(normalizedTitle)) {
      throw new Error("health-audit output contains duplicate findings");
    }
    dedupeKeys.add(finding.dedupeKey);
    normalizedTitles.add(normalizedTitle);
  }

  return {
    executiveVerdict: asString(
      record.executive_verdict,
      "executive_verdict",
      10,
      2_000,
    ),
    focus: asString(record.focus, "focus", 3, 500),
    findings,
    investigatedButRejected: asStringArray(
      record.investigated_but_rejected,
      "investigated_but_rejected",
      30,
    ),
    notableStrengths: asStringArray(record.notable_strengths, "notable_strengths", 30),
  };
}

export function normalizeIssueTitle(title: string): string {
  return title.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

export function auditMarker(dedupeKey: string): string {
  return "<!-- automated-health-audit:" + dedupeKey + " -->";
}

export function findDuplicateIssue(
  finding: AuditFinding,
  issues: ExistingIssue[],
): ExistingIssue | undefined {
  const title = normalizeIssueTitle(finding.title);
  const marker = auditMarker(finding.dedupeKey);
  return issues.find(
    (issue) => normalizeIssueTitle(issue.title) === title || issue.body.includes(marker),
  );
}

export function renderIssueBody(
  finding: AuditFinding,
  report: AuditReport,
  metadata: PublicationMetadata,
): string {
  const tick = String.fromCharCode(96);
  const evidence = finding.evidence.map(
    (item) =>
      "- " +
      tick +
      item.path +
      ":" +
      item.line +
      tick +
      " — " +
      item.explanation,
  );
  const assumptions =
    finding.assumptions.length === 0
      ? ["- None beyond the source-level audit limitations described above."]
      : finding.assumptions.map((assumption) => "- " + assumption);

  return [
    "## Summary",
    "",
    finding.summary,
    "",
    "## Classification",
    "",
    "- Severity: " + tick + "severity:" + finding.severity + tick,
    "- Root-cause type: " + tick + "type:" + finding.type + tick,
    "",
    "## Root cause",
    "",
    finding.rootCause,
    "",
    "## Evidence",
    "",
    ...evidence,
    "",
    "## Impact",
    "",
    finding.impact,
    "",
    "## Realistic failure scenario",
    "",
    finding.failureScenario,
    "",
    "## Why existing tests/checks miss it",
    "",
    finding.testsMiss,
    "",
    "## Duplicate search",
    "",
    finding.duplicateSearch,
    "",
    "## Remediation approaches",
    "",
    "1. " + finding.remediation[0],
    "2. " + finding.remediation[1],
    "",
    "## Confidence and assumptions",
    "",
    "**Confidence:** " + finding.confidence,
    "",
    ...assumptions,
    "",
    "## Automated audit context",
    "",
    "- Focus: " + report.focus,
    "- Commit: " + tick + metadata.commitSha + tick,
    "- Run: [GitHub Actions](" + metadata.runUrl + ")",
    "",
    "This issue was produced by the scheduled health audit. It should be reviewed before implementation.",
    "",
    auditMarker(finding.dedupeKey),
  ].join("\n");
}

export function buildPublicationPlan(
  report: AuditReport,
  issues: ExistingIssue[],
  availableLabels: Set<string>,
  metadata: PublicationMetadata,
): PublicationPlan {
  const requiredLabels = new Set<string>(["automated"]);
  for (const finding of report.findings) {
    requiredLabels.add("severity:" + finding.severity);
    requiredLabels.add("type:" + finding.type);
  }
  const missingLabels = [...requiredLabels].filter((label) => !availableLabels.has(label));
  if (missingLabels.length > 0) {
    throw new Error("required GitHub labels are missing: " + missingLabels.sort().join(", "));
  }

  const plan: PublicationPlan = { pending: [], duplicates: [] };
  for (const finding of report.findings) {
    const duplicate = findDuplicateIssue(finding, issues);
    if (duplicate) {
      plan.duplicates.push({ finding, issue: duplicate });
      continue;
    }
    plan.pending.push({
      finding,
      title: finding.title,
      body: renderIssueBody(finding, report, metadata),
      labels: [
        "automated",
        "severity:" + finding.severity,
        "type:" + finding.type,
      ],
    });
  }
  return plan;
}
