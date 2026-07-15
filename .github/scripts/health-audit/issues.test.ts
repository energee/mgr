import { describe, expect, it } from "vitest";
import {
  auditMarker,
  buildPublicationPlan,
  findDuplicateIssue,
  parseAuditReport,
  renderIssueBody,
  type ExistingIssue,
} from "./issues";

const validReport = {
  executive_verdict: "One contained authorization defect was confirmed in the focused slice.",
  focus: "API authorization and privileged clients",
  findings: [
    {
      dedupe_key: "settings-api-key-missing-permission",
      title: "API key settings route lacks a permission check",
      severity: "high",
      type: "authorization",
      summary: "An authenticated user can reach a privileged settings operation without the required permission.",
      root_cause: "The route verifies identity but does not perform the permission check required before privileged access.",
      evidence: [
        {
          path: "src/app/api/settings/api-key/route.ts",
          line: 42,
          explanation: "The route creates the privileged client immediately after authentication.",
        },
      ],
      impact: "A lower-privileged account can read or replace an organization-wide integration credential.",
      failure_scenario: "A production user without settings permission calls the route directly and replaces the shared credential.",
      tests_miss: "Route tests mock authentication as sufficient and never exercise a user that lacks settings permission.",
      duplicate_search: "Searched open and closed issues for the route, API keys, settings permissions, and privileged clients; no match found.",
      confidence: "high",
      assumptions: ["The route is deployed with the service-role client shown in the current checkout."],
      remediation: [
        "Require the established settings permission before creating the privileged client and add negative route tests.",
        "Move credential mutation behind a permission-enforcing database function and keep the route as a thin caller.",
      ],
    },
  ],
  investigated_but_rejected: ["A UI-only permission check was backed by RLS and was not reportable."],
  notable_strengths: ["The related credential test route already enforces the settings permission."],
};

const metadata = {
  commitSha: "0123456789abcdef",
  runUrl: "https://github.com/energee/mgr/actions/runs/123",
};

const labels = new Set([
  "automated",
  "severity:high",
  "type:authorization",
]);

describe("health audit issue publication", () => {
  it("parses a schema-shaped report into the internal representation", () => {
    const report = parseAuditReport(JSON.stringify(validReport));

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      dedupeKey: "settings-api-key-missing-permission",
      severity: "high",
      type: "authorization",
    });
    expect(report.investigatedButRejected).toHaveLength(1);
  });

  it("rejects unsafe paths and low-confidence or low-severity output", () => {
    const unsafePath = structuredClone(validReport);
    unsafePath.findings[0].evidence[0].path = "../../.env";
    expect(() => parseAuditReport(JSON.stringify(unsafePath))).toThrow(
      "repository-relative path",
    );

    const lowSeverity = structuredClone(validReport);
    lowSeverity.findings[0].severity = "low";
    expect(() => parseAuditReport(JSON.stringify(lowSeverity))).toThrow(
      "severity must be one of",
    );

    const lowConfidence = structuredClone(validReport);
    lowConfidence.findings[0].confidence = "low";
    expect(() => parseAuditReport(JSON.stringify(lowConfidence))).toThrow(
      "confidence must be one of",
    );
  });

  it("rejects duplicate findings and more than eight findings", () => {
    const duplicate = structuredClone(validReport);
    duplicate.findings.push(structuredClone(duplicate.findings[0]));
    expect(() => parseAuditReport(JSON.stringify(duplicate))).toThrow(
      "duplicate findings",
    );

    const tooMany = structuredClone(validReport);
    tooMany.findings = Array.from({ length: 9 }, (_, index) => ({
      ...structuredClone(validReport.findings[0]),
      dedupe_key: "distinct-finding-" + index,
      title: "Distinct confirmed finding number " + index,
    }));
    expect(() => parseAuditReport(JSON.stringify(tooMany))).toThrow(
      "at most 8 items",
    );
  });

  it("finds duplicates across closed issues by normalized title or audit marker", () => {
    const report = parseAuditReport(JSON.stringify(validReport));
    const finding = report.findings[0];
    const titleMatch: ExistingIssue = {
      number: 41,
      title: "  API KEY SETTINGS ROUTE LACKS A PERMISSION CHECK  ",
      body: "old body",
      state: "closed",
      url: "https://github.com/energee/mgr/issues/41",
    };
    expect(findDuplicateIssue(finding, [titleMatch])).toBe(titleMatch);

    const markerMatch: ExistingIssue = {
      ...titleMatch,
      number: 42,
      title: "A renamed issue",
      body: auditMarker(finding.dedupeKey),
    };
    expect(findDuplicateIssue(finding, [markerMatch])).toBe(markerMatch);
  });

  it("fails before publication when a required taxonomy label is missing", () => {
    const report = parseAuditReport(JSON.stringify(validReport));
    expect(() =>
      buildPublicationPlan(
        report,
        [],
        new Set(["automated", "severity:high"]),
        metadata,
      ),
    ).toThrow("type:authorization");
  });

  it("builds a labeled issue with exact evidence, audit context, and a stable marker", () => {
    const report = parseAuditReport(JSON.stringify(validReport));
    const plan = buildPublicationPlan(report, [], labels, metadata);

    expect(plan.pending).toHaveLength(1);
    expect(plan.pending[0].labels).toEqual([
      "automated",
      "severity:high",
      "type:authorization",
    ]);
    expect(plan.pending[0].body).toContain(
      "src/app/api/settings/api-key/route.ts:42",
    );
    expect(plan.pending[0].body).toContain(metadata.commitSha);
    expect(plan.pending[0].body).toContain(
      auditMarker("settings-api-key-missing-permission"),
    );
    expect(renderIssueBody(report.findings[0], report, metadata)).toBe(
      plan.pending[0].body,
    );
  });

  it("plans no mutation when an open or closed duplicate already exists", () => {
    const report = parseAuditReport(JSON.stringify(validReport));
    const existing: ExistingIssue = {
      number: 99,
      title: report.findings[0].title,
      body: "",
      state: "closed",
      url: "https://github.com/energee/mgr/issues/99",
    };
    const plan = buildPublicationPlan(report, [existing], labels, metadata);

    expect(plan.pending).toEqual([]);
    expect(plan.duplicates).toEqual([{ finding: report.findings[0], issue: existing }]);
  });
});
