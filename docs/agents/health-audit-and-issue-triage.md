# Health audit and GitHub issue triage

Use this guide for evidence-first repository health audits that may later become
GitHub issues. It keeps code inspection, issue creation, and issue
classification as separate authorization phases so a read-only audit cannot
silently mutate the repository or its issue tracker.

Read this guide together with:

- [process.md](process.md) for repository workflow and verification rules
- [quality.md](quality.md) for the current health baseline
- [dispatching-agents.md](dispatching-agents.md) before delegating audit slices
- The relevant [expert-agent files](../../.claude/agents/) for each domain

## Authorization boundaries

Treat each phase as a distinct operation:

1. **Audit:** inspect code, history, tests, and existing issues. Do not edit
   files or mutate GitHub.
2. **Report:** present confirmed findings, rejected candidates, safeguards, and
   recommended priority. Reporting does not authorize issue creation.
3. **Create issues:** proceed only after the user explicitly asks for issues to
   be filed. Recheck duplicates immediately before creation.
4. **Classify issues:** proceed only after the user explicitly asks for severity
   or type labels to be added or changed.
5. **Change issue state:** closing, reopening, assigning, or editing existing
   issue content requires explicit authorization of that action.

Never contact the live database, retrieve credentials, print environment
values, or include secrets or customer data in evidence. A request to audit
source code does not authorize production access.

## 1. Establish the audit baseline

Before inspecting candidates:

1. Read [AGENTS.md](../../AGENTS.md), [PROGRESS.md](../../PROGRESS.md),
   [DECISIONS.md](../../DECISIONS.md), this guide, quality.md, and
   dispatching-agents.md.
2. Read the matching expert-agent file before inspecting each domain.
3. Record the current checkout, branch, commit, and working-tree status with
   pwd, git branch --show-current, git rev-parse HEAD, and git status --short.
4. Preserve all existing uncommitted changes. A read-only audit must leave the
   checkout byte-for-byte unchanged.
5. Record the requested scope, forbidden actions, already-known findings, and
   defect classes to prioritize.
6. Decide which checks are safe and read-only. Treat stale dependency installs
   as an environment limitation, not a committed-code defect.

Do not infer a defect from an audit document alone. Documents help prioritize
inspection; the current code is the source of evidence.

If a candidate exists only in an uncommitted change, say so explicitly and
confirm that the user wants it tracked before filing an issue. Prefer
commit-pinned GitHub line links in issue evidence when the cited code is available on
the remote; also include the readable file:line reference.

## 2. Divide independent audit slices

Use focused subagents only when the request or
[dispatching-agents.md](dispatching-agents.md) justifies parallel work. Good
independent slices include:

- API authentication and authorization
- Supabase error handling, data integrity, and transaction boundaries
- Third-party integrations, OAuth, webhooks, retries, and idempotency
- Migrations, RLS, SECURITY DEFINER functions, CI, and production configuration

Give every audit agent the same constraints and output contract:

- Read-only inspection only
- Explicit list of already-reported issues to exclude
- Exact directories and defect classes in scope
- Complete call/data-path tracing before reporting
- Exact file and line citations
- Concrete failure scenario and affected users or records
- Explanation of why tests or checks miss the defect
- Confidence and assumptions
- Open and closed GitHub duplicate search
- Rejected candidates as well as confirmed findings

Keep GitHub mutation with one coordinating agent. Parallel agents should not
create or edit issues independently because they cannot reliably deduplicate
against one another while running.

## 3. Build evidence for each candidate

A reportable finding needs a complete causal chain, not a suspicious line.
Trace the path appropriate to the defect:

    UI or caller
      -> API route or server action
      -> authentication and permission decision
      -> service or integration orchestration
      -> Supabase query, RPC, policy, or external request
      -> cache invalidation, retry, and user-visible result

At each boundary, verify the following where applicable:

- **Authorization:** distinguish identity verification from permission checks.
  Routes using a service-role or admin client need an explicit authorization
  decision before privileged access.
- **Supabase errors:** inspect both data and error for every read and write.
  Confirm failures cannot become successful empty results or partially applied
  mutations.
- **Transaction integrity:** identify multi-step state changes that must commit
  or roll back together, including inventory, accounting, fulfillment,
  packaging, purchasing, and synchronization.
- **Integrations:** verify OAuth state handling, credential ownership and
  storage, tenant scoping, webhook verification, replay protection,
  idempotency, and retry behavior.
- **Database security:** trace RLS and grants at runtime. Check SECURITY DEFINER
  execution privileges and search paths. Do not treat SQL text matching as
  proof of deployed behavior.
- **Client permissions:** verify that any hidden or disabled control is backed
  by API or database enforcement.
- **Background state:** follow jobs, caches, retries, and query invalidation
  until the final operational state is consistent.
- **Production gates:** identify fallbacks or skipped checks that can turn a
  required production invariant into a silent success.

Reject candidates that depend on an implausible precondition, are blocked by a
downstream policy, duplicate a harmless convention, or cannot produce a
realistic user or operational impact.

## 4. Run proportionate read-only checks

Prefer focused searches and static checks before broad suites. Useful examples
include:

    rg "createAdminClient|service_role" src
    rg "await .*\.from\(|await .*\.rpc\(" src
    rg "SECURITY DEFINER|GRANT EXECUTE|ENABLE ROW LEVEL SECURITY" supabase/migrations
    make check-db

Run targeted tests when they can validate a candidate without changing state.
Do not contact a live database or third-party service merely to strengthen a
source-level audit. State any resulting verification limitation as an
assumption.

## 5. Search all GitHub issues for duplicates

Search open and closed issues before reporting a candidate and repeat the
search immediately before creating an issue:

    gh issue list --state all --limit 1000 \
      --json number,title,state,body,labels,url > /tmp/all-issues.json

Search titles and bodies for the affected component, operation, error mode, and
business consequence. A similar symptom is not automatically a duplicate;
compare root cause, call path, affected records, and remediation boundary.

- **Exact or encompassing match:** do not create a new issue. Cite the existing
  issue.
- **Related but materially different root cause or scope:** create only when
  authorized and link the related issue in the body.
- **Closed match:** determine whether current code is the same defect, a
  regression, or merely analogous. Do not reopen without authorization.

## 6. Report confirmed findings

Rank findings by concrete impact. Use current severity for open defects and
historical severity for closed issues; do not downgrade a resolved issue merely
because it is closed.

| Severity | Standard |
|---|---|
| Critical | Credible immediate organization-wide compromise, catastrophic irreversible loss, or a production-wide safety failure with no meaningful barrier. |
| High | Authorization bypass, major financial or inventory corruption, cross-tenant exposure, or substantial data loss with a realistic path. |
| Medium | Contained operational failure, meaningful control gap, stale or contradictory state, or recoverable data-integrity failure. |
| Low | Limited-impact defect, maintenance burden, or developer-experience problem without a realistic production correctness failure. |
| Informational | Tracking, documentation, stale/duplicate cleanup, upstream limitation, or accepted follow-up with no current product defect. |

Use this structure for every finding:

1. Title and severity
2. Root cause
3. Exact evidence with file:line citations
4. User or business impact and a realistic failure scenario
5. Why existing tests or checks miss it
6. Confidence and assumptions
7. Existing GitHub issue match, including closed matches
8. Two remediation approaches ranked by likelihood and safety

Finish the report with investigated-but-rejected candidates, notable strengths
and safeguards, and the recommended filing/fix order. Rejected candidates are
important audit evidence: they prevent later reviewers from repeatedly
reporting the same false positives.

## 7. Create issues after explicit approval

Before creating each issue:

1. Re-read the cited code and verify line numbers against the current checkout.
2. Repeat the open-and-closed duplicate search.
3. Remove secrets, customer data, and unnecessary implementation speculation.
4. Confirm the issue is independently actionable. Split unrelated root causes.
5. Prepare the body for review before invoking gh issue create.

Recommended issue body:

    ## Summary
    Concise statement of the defect and violated invariant.

    ## Root cause
    The causal implementation or configuration error.

    ## Evidence
    - path/to/file.ts:line — what the code establishes
    - path/to/other.sql:line — how enforcement or failure handling completes the path

    ## Impact
    A realistic sequence from user action or event to incorrect outcome.

    ## Why checks miss it
    The exact test, mock, static-check, or runtime coverage gap.

    ## Remediation options
    1. Preferred approach and why it is safer or more likely to succeed
    2. Alternative approach and its tradeoff

    ## Acceptance criteria
    Observable correctness, authorization, rollback, or idempotency properties.

    ## Verification
    Targeted tests and relevant repository quality gates.

    ## Confidence and assumptions
    Confidence level plus any production-schema or deployment assumption.

Create the issue from a reviewed body file, capture the returned URL, and then
read it back:

    gh issue create --title "Concise defect title" --body-file /path/to/reviewed-body.md
    gh issue view ISSUE_NUMBER --json number,title,state,labels,body,url

Do not create placeholder issues to reserve numbers. If issue creation fails,
check whether the request actually succeeded before retrying to avoid
duplicates.

## 8. Add severity and root-cause type labels

Classify issues only after explicit approval. Preserve existing component,
feature, and workflow labels, and assign exactly:

- One severity label
- One primary root-cause type label

Choose the type from the cause, not the visible symptom. If two independent
causes need different type labels, the issue probably needs to be split.

| Type label | Primary root cause |
|---|---|
| type:authorization | Missing or incorrect permission, tenant, ownership, or privileged-access enforcement |
| type:account-provisioning | User invitation, identity creation, role assignment, or onboarding inconsistency |
| type:transaction-integrity | Multi-step writes can partially commit, race, duplicate, or violate an atomic invariant |
| type:silent-failure | An error is discarded or converted into apparent success or empty data |
| type:migration-drift | Migration replay, ordering, or expected schema differs from the migration chain |
| type:deployment-drift | Deployed schema or configuration differs from the committed expected state |
| type:dependency-security | Vulnerable, stale, or unaudited third-party dependency state |
| type:test-infrastructure | Test harness, fixtures, environment, or behavioral coverage cannot validate the required path |
| type:production-runtime | Production build or runtime behavior fails independently of business logic |
| type:data-lifecycle | Retention, deletion, cleanup, archival, or ownership lifecycle defect |
| type:upstream-tooling | Root cause is an external framework or tool limitation being tracked locally |
| type:dev-artifact | Generated, local-only, or development artifact creates noise or inconsistency |
| type:quality-gate | Required CI or repository gate is missing, skipped, or non-enforcing |
| type:maintenance | Repository upkeep with no narrower correctness category |
| type:documentation | Missing, stale, or misleading documentation without a product-code defect |

List existing labels before creating new taxonomy labels. Add labels without
removing unrelated labels:

    gh label list --limit 1000
    gh label create "severity:high" \
      --description "High-severity defect" --color D93F0B
    gh label create "type:authorization" \
      --description "Authorization or tenant enforcement" --color 5319E7
    gh issue edit ISSUE_NUMBER \
      --add-label "severity:high" \
      --add-label "type:authorization"

After classifying the requested issue population, verify cardinality and
produce a deterministic severity ranking:

    gh issue list --state all --limit 1000 \
      --json number,title,state,labels,url |
    jq '
      map({
        number,
        title,
        state,
        url,
        severity: [.labels[].name | select(startswith("severity:"))],
        type: [.labels[].name | select(startswith("type:"))]
      })
      | {
          invalid: map(select((.severity | length) != 1 or (.type | length) != 1)),
          ranked: sort_by(
            if .severity[0] == "severity:critical" then 0
            elif .severity[0] == "severity:high" then 1
            elif .severity[0] == "severity:medium" then 2
            elif .severity[0] == "severity:low" then 3
            else 4 end,
            .number
          )
        }
    '

The invalid list must be empty. Verify issue states and unrelated labels were
not changed.

## Completion checklist

For a read-only audit:

- [ ] Every finding traces the complete call/data path.
- [ ] Every citation matches current code and exact line numbers.
- [ ] Every candidate was searched against open and closed issues.
- [ ] Speculative and harmless candidates are recorded as rejected, not filed.
- [ ] Confidence and assumptions are explicit.
- [ ] The repository working tree is unchanged.

When issue creation or classification was authorized:

- [ ] Every new issue was checked again for duplicates immediately before creation.
- [ ] Every created or edited issue was read back and its URL recorded.
- [ ] Every issue has exactly one severity and one primary type label.
- [ ] Existing labels and issue states were preserved unless separately authorized.
- [ ] The final response identifies created issues, duplicate matches, rejected candidates, and any verification limitation.
