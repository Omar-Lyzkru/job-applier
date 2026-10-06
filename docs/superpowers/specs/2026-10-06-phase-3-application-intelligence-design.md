# Phase 3 — Application Intelligence: design and subphase boundaries

Date: 2026-10-06. Inspected base: `2443efd`.

**Status: architecture and 3A scope approved on 2026-10-06; planning only.**
Phase 2 is approved complete. The user approved this presented design; the 3A
implementation plan is the next review gate. Later subphase execution remains
subject to separate approval after each completed subphase.
This document does not authorize implementation, migration, application runs,
or work on Phases 4–6. Approve one subphase at a time. Each needs a bounded
implementation plan, implementation, tests, verification, a completion report,
and a stop before the next subphase. No product code or tests were run for this
design; inspection used source, test cases, and existing documentation only.

## 1. Current-state assessment

The approved Phase 1 design, Phase 2 design and implementation plan, and
`docs/verification.md` establish a working local Node/JSON application. Phase 2's
delivery record reports 199 passing unit/API tests and 148 browser tests. Those
are historical results, not fresh verification of Phase 3.

| Area | Current implementation and useful boundary |
| --- | --- |
| Question meaning | `answer-memory.mjs` has finite aliases, separate current/completed education and total/professional skill years, US authorization versus combined now/future sponsorship, employer SMS scope, and conservative suggestions. `describeQuestion` already exposes meaning, scope and risk. |
| Resolution | `domain.mjs` validates saved choices by displayed meaning and preserves No/false/zero. Exact saved answers precede equivalents and profile contact aliases. It does not infer screening answers from job-fit facts or a résumé. |
| Storage | `answers.json` is a flat normalized-label map. `validateAnswers` strips punctuation; distinct C/C++/C# labels can collapse. The experience resolver guards this known ambiguity. Original lost punctuation cannot be reconstructed reliably. |
| Question UI | Bootstrap enriches pending occurrences, and `question-groups.mjs` groups compatible controls/scopes while preserving job-specific blockers and stable draft identity. Answers already has common questions, pending editors, SMS scope, provenance and a saved library. |
| Fit | `job-intelligence.mjs` emits deterministic apply/review/skip decisions and evidence. The runner currently records review decisions as skipped outcomes. The Dashboard displays fit explanations, but these skipped review cases do not normally enter Needs attention. |
| Duplicates | `job-duplicates.mjs` blocks exact IDs and strong fingerprints for protected attempts. It has no separate weak-evidence review model. Strong protection must remain authoritative. |
| Reliability | Canonical history contains lifecycle, revisions, questions and typed blockers. `questions.json` is a compatibility projection; attention uses full history. Atomic claims/reservations, recovery, Stop, bounded forms and fresh final validation already work. |
| Workflow | Dashboard Needs attention and Answers are existing destinations. Single-job retries and ready batches are explicit, guarded, linked to prior history, and use frozen run snapshots. Saving or startup never launches work. |

The appropriate extension is richer information and explicit review on these
boundaries. Replacing the runner, database, form convergence or dashboard would
add risk without solving the answer-context problem.

## 2. Exact problems worth solving

1. A finite classifier cannot yet explain all important screening distinctions.
   Similar wording may concern different time periods, qualifications or intents.
2. Except for SMS and skill-year descriptors, saved values cannot express an
   employer, job, jurisdiction, time period, salary unit or consent purpose.
3. Legacy normalized keys can lose identity; broader matching would amplify this
   problem. The UI needs a safe way to confirm distinct identities and values.
4. Fit review, question ambiguity and operational blockers have different amounts
   of evidence and different safe next steps, but no shared review contract.
5. A previously skipped fit-review job lacks an explicit inspection-only recheck
   after the user changes relevant settings. Ordinary retry should not acquire a
   general-purpose override to solve this.

Success means fewer repeated compatible questions, explainable non-reuse when
meaning differs, preserved explicit answers, and one understandable path from
attention to a separate user-triggered retry. It does not mean answering more
questions through guesswork or increasing submissions at the expense of safety.

## 3. Excluded features

No LLM/API keys, paid services, cloud database, proxies, new job platform, parallel
application browsers, new scoring engine, generated screening answers, automatic
salary negotiation, inferred legal facts, or generalized natural-language logic.
No universal custom-widget support or authentication workaround. No résumé
rewriting/tailoring, analytics/ATS dashboard, interview pipeline, or expansion
into Phases 4–6. No automatic legacy migration or automatic run after a review.
No button to override eligibility, cap, attempted timestamps or strong duplicates.

## 4. Approaches and recommended architecture

| Approach | Benefit | Cost / reason for choice |
| --- | --- | --- |
| Add more flat aliases only | Smallest change | Leaves context and collisions unresolved; increasingly difficult to prove safe. Use finite aliases within 3A, but not as the entire Phase 3 architecture. |
| Add typed meaning, scoped entries and reviews to existing systems | Local, incremental, independently testable | Some compatibility work, but preserves history, legacy answers and runner guards. **Recommended.** |
| Replace storage/workflow or add an AI agent | Broad flexibility | Excess cost, opaque decisions, migration and submission risk. Excluded. |

Flow: observed form question → deterministic descriptor → compatibility checks →
explicit answer resolution or a review reason → existing form verification.
Fit assessments and form blockers feed the same attention projection. A saved
review decision records what the user chose; it is not execution authorization.

Keep pure interpretation separate from storage, UI and browser operations:

- A small `screening-intelligence.mjs` defines reviewed question descriptors and
  compatibility/risk explanations. Existing `describeQuestion` remains its adapter.
- A small `answer-bank.mjs` owns scoped-entry validation and deterministic selection.
  The existing resolver remains the public fill/missing contract.
- An `application-review.mjs` constructs bounded review metadata and permitted
  actions from existing assessments, blockers and answer resolutions.
- `store.mjs` retains serialized, atomic writes, revision checks and data ownership.
  The runner retains the submission path and snapshot policy.

No new runtime dependency is expected; runtime remains approximately $0/month
using the user's computer. Unknown English phrasing remains reviewable rather
than expanding into an unbounded parser.

## 5. Screening semantics and deterministic risk

Descriptors identify a concept **and its qualifiers**, not just shared words.
An unrecognized qualifier, compound question or negation prevents equivalence.

| Question family | Boundaries that must remain distinct |
| --- | --- |
| Experience | Overall vs skill-specific; total vs professional; paid/full-time/recent/production qualifiers; individual technologies vs combinations; scalar years vs offered ranges. C/C++/C# preserve punctuation. |
| Education | Current student vs graduate; full-time/undergraduate/college status vs generic student; pursuing degree vs completed degree; current vs previous/graduated school; expected vs actual graduation; exact requested date format. |
| Legal | Authorization vs citizenship; explicitly stated jurisdiction; sponsorship now, future, and combined now-or-future remain three separate meanings. Never derive one from another, even when a logical interpretation appears possible. |
| Willingness | Willing to relocate/travel/work onsite vs currently located there, eligible there, or possessing required qualifications. |
| Consent | Employer, purpose and wording/terms identity. Application SMS does not cover marketing, background checks or other consent. Unknown employer remains manual. |
| Salary | Currency, hourly/monthly/annual period, amount vs range, and explicitly supplied basis such as gross/net. Missing units do not default from job location. |
| Time/location | Current/as-of/future period and expressly named country/place. No automatic conversion of expected graduation into graduate status or address into eligibility. |

School, résumé, name, address, matching profile and job description cannot supply
unknown applicant screening facts. A job description may provide the employer's
requirement as evidence, not the applicant's answer. Existing explicit contact
profile aliases continue to work; they do not answer screening questions.

Risk has two axes: **impact** and **reuse decision**. A correctly scoped, explicit
legal answer is high impact but can be reusable; high impact alone must not cause
the same confirmed question to repeat on every application.

- Low impact: ordinary known fact/preference with compatible explicit scope.
- Medium impact: time-dependent education/experience or changed form/context.
- High impact: legal, citizenship, consent, salary, identity, ambiguous meaning.
- Reuse decision: `compatible`, `confirmation_required`, or `manual_only`, with
  fixed reason codes and provenance. No percentage confidence or AI score.

Changed displayed choices, format, scope, unavailable required context, conflicting
answers or unsupported controls can require confirmation/manual completion at
any impact level. Suggestions never select a control or become a saved value.

3A's initial automatic-equivalence expansion is limited to finite, tested wording
for explicitly named total/professional experience, existing supported skills,
current/completed education, and separately stated US sponsorship periods. Each
period only matches an explicit answer to that same period. Salary, non-SMS
consent, relocation and unfamiliar employer requirements receive descriptors and
review explanations only; 3A adds no new automatic equivalents for them. Existing
safe exact answers continue under the current guards. C-family legacy resolution
remains manual in 3A; new distinct confirmed identities belong to the bank work.

## 6. Recommended subphases and order

| Subphase | Independently useful result | Boundary / dependencies | Complexity |
| --- | --- | --- | --- |
| **3A — Screening meanings and explanations** | Pending cards explain what a question means, the relevant qualifier, and why a saved answer can or cannot be used. Carefully tested finite aliases reduce repeats for supported meanings. | Extend current descriptors/resolution and existing Answers UI. No storage migration, scoped-bank editor or new retry command. Existing exact precedence and safeguards stay intact. | Medium; roughly 3–4 cohesive implementation/test tasks. |
| **3B — Scoped answers for new confirmations** | User saves an answer for this job, employer or an allowed reusable concept and can see/edit/delete that scope and source. Confirmed compatible repetitions reuse it. | Depends on 3A. Add bank storage, resolver integration, guarded entry operations and minimal Answers editors. Leave legacy files/keys intact; no bulk import. Unknown/new concepts default to exact job scope. | Medium–high; roughly 4–5 tasks, concentrated on storage and compatibility. |
| **3C — Optional collision-safe legacy review/import** | User previews old answers and explicitly confirms which labels/scopes to retain. Distinct C/C++/C# answers can then be saved safely in the new bank. | Depends on 3B. Explicit preview, backup, checked commit and rollback. Do not reconstruct lost original wording or automatically widen legacy scope. Works even if user imports nothing. | Medium; roughly 3–4 tasks. |
| **3D — Unified review explanations** | Needs attention includes fit-review jobs as well as screening/form problems, with evidence, known/unknown facts and safe next steps. Answers and History link to the same review identity. | Depends on 3A/3B; can technically precede optional 3C. Add durable review metadata and one attention projection, plus existing answer/settings/manual/retry links. No fit recheck command yet. | Medium; roughly 4 tasks. |
| **3E — Explicit fit recheck workflow** | After editing relevant settings, user rechecks a selected fit-review job without searching or opening its application form; a fresh passing assessment offers a separate explicit retry. | Depends on 3D. Bounded inspection-only command and guarded eligibility bridge, revision/staleness handling. No eligibility override, manual submission claim, automatic retry or new lifecycle states. | Medium–high; roughly 4 tasks, mostly guard/recovery coverage. |

Recommended delivery order: **3A → 3B → 3C → 3D → 3E**, stopping after every
verified subphase. 3C is optional for users, not required for new scoped answers;
3D does not depend on a successful legacy import. Approximate task counts describe
size, not promises about time or usage. If a bounded implementation plan exceeds
one reasonable session, narrow that subphase before approval rather than silently
combining or expanding it.

**Implement 3A first after approval.** It directly addresses repeated/confused
questions, uses the existing storage and UI, establishes the compatibility rules
needed by 3B, and exposes explanations before any migration or new job action.

## 7. Likely modules affected

| Subphase | Source / UI | Relevant tests to extend |
| --- | --- | --- |
| 3A | New `src/screening-intelligence.mjs`; `src/answer-memory.mjs`, `src/domain.mjs`, `src/question-groups.mjs`, `src/server.mjs`, `public/app.js`, small CSS changes | `test/domain.test.mjs`, `test/question-groups.test.mjs`, `test/server.test.mjs`, `test/dashboard.test.mjs`; focused native screening fixtures |
| 3B | New `src/answer-bank.mjs`; store/domain/memory/groups/server/app; snapshot/context plumbing in `src/runner.mjs`, `src/browser/linkedin.mjs`, `src/browser/forms.mjs` | Bank unit tests; store/server/runner/forms/dashboard tests |
| 3C | Bank/store/server/app; a small pure migration-preview module if needed | Migration fixtures and bank/store/server/dashboard tests |
| 3D | New `src/application-review.mjs`; runner/store/attention/server/app; narrow weak-evidence helper in `src/job-duplicates.mjs` | Review unit tests; job/attention/store/runner/server/dashboard tests |
| 3E | Runner/store/review/attention/server/app; fixed inspection-review blocker if needed in `src/application-lifecycle.mjs` | Lifecycle/store/runner/server/dashboard and local adapter inspection tests |

README and `docs/verification.md` get scoped usage/results additions at each
completed implementation. Existing approved specs/plans remain historical records.
Do not restructure unchanged form/submission code to accommodate these modules.

## 8. Proposed additive data model

### Question descriptor

Versioned metadata: `concept`, qualifier fields (`experienceKind`, `skill`,
`educationStatus`, `timeScope`, `jurisdiction`, `purpose` as applicable), raw label,
punctuation-preserving exact identity, control type, displayed-choice signature,
format/constraints, required context, impact and reuse policy/reason.

Use null for unknown context, never as a wildcard. Scope requirements depend on
the concept: a global school name need not have an employer, but employer consent
must. An explicitly global entry is a user-approved reuse scope, not absent data.
Keep exact normalized legacy keys separately; do not change `normalizeQuestion`
globally and thereby reinterpret all stored answers and question IDs.

### Scoped bank

An additive private `data/answer-bank.json`, schema version 1, contains a bank
revision and entries with stable IDs/revisions, typed scalar value, raw source
question, descriptor/version, exact identity, explicit scope, compatible control/
choices/format constraints, provenance, confirmation timestamps and active/retired
state. Scope is job, employer or allowed reusable concept with any required time,
jurisdiction/consent/salary qualifiers. Capture only dimensions actually needed by
the concept. Preserve string/number/boolean types, including zero and false.

Legacy `answers.json` stays readable and unchanged by adoption. Existing clients
and common-question editors retain their legacy contract until deliberately
updated. New entry endpoints operate by ID and expected revision instead of
replacing the whole bank. Missing bank file means legacy-only operation; malformed
existing bank is an explicit storage error, never a silently empty bank.

Resolution order:

1. Existing manual/control/scope guards apply. Collision guards prohibit resolving
   a C-family value from a collapsed legacy key. A new explicitly confirmed,
   punctuation-preserving bank identity does not read or reinterpret that key;
   it may resolve only after proving its own skill/control/scope compatibility.
2. Use an explicitly confirmed scoped **exact** entry for this observed identity.
   A scoped replacement must be a deliberate save showing the previous exact
   value; never silently promote an equivalent over an existing exact answer.
3. Otherwise retain compatible legacy exact-match precedence.
4. Consider compatible equivalents from approved bank entries and the existing
   finite legacy aliases. Conflicting meanings/values require review; do not
   choose the newest entry or infer a hierarchy between overlapping scopes.
5. Keep existing explicit contact aliases. Otherwise return missing/review.

Ambiguous/unrecognized questions may be explicitly answered for the exact job and
observed question/constraints after user review; they gain no cross-job equivalence.
Unsupported controls remain manual even when an answer is known. Expiry/as-of
restrictions only apply when explicitly recorded; stale entries need confirmation,
not an inferred replacement. No résumé-to-bank or bank-to-job-fit fact conversion.

A run freezes bank revision/content alongside config, legacy answers and résumé.
All resolver callers—including attention readiness, grouping, browser entry and
final validation—use the same compatibility contract. Polling sees current bank
state for the next run but cannot mutate an active run's snapshot.

### Legacy bindings and migration

Imported entries record the source legacy key and typed-value digest. Bindings
are stored in the same atomic bank file as entries. A changed/deleted backing
legacy value invalidates an unconfirmed imported binding; it cannot resurrect a
stale answer. Explicit promotion to an independent scoped entry requires user
confirmation and is displayed as such. Retired scoped ownership records prevent
deleting a migrated/replaced entry from silently falling back to its old legacy
answer for that same scope. Other legacy scopes remain intact.

### Review metadata

Optional versioned `reviews` metadata lives on canonical history records, with
stable review IDs and revision-checked decisions. No separate review database,
no replacement for pending questions, no new application status machine.
Outcome-time review creation shares the canonical history mutation. Later user
decisions use a dedicated revision-checked review mutation that preserves job,
status, attempted/finished times and blockers; it can update review metadata,
revision and update time only. Staleness checks compare the relevant evidence
and input fields, so unrelated settings edits do not invalidate a decision.

Each review contains kind, source record/lineage/job and question identity where
applicable, blocking/advisory classification, impact, fixed reason, bounded source
evidence, known/unknown facts with provenance, suggested user actions, continuation
conditions, evidence/input revision, decision and timestamps. A decision is
`open`, `deferred`, `acknowledged`, or `resolved` for the information issue; it is
never an application outcome or permission to submit.

Types: fit threshold, unknown eligibility, ambiguous screening, risky reuse,
unsupported control, unusual/compound employer requirement, and weak duplicate
evidence. Weak evidence uses known same employer/title/location with differing or
missing description identity; it is advisory, clearly inconclusive, and never a
strong fingerprint or proof of a previous submission. Bound comparisons to local
history; no fuzzy external service or unbounded pairwise discovery scan.

Resolved information can coexist with an unresolved entry/verification blocker.
Changed relevant evidence invalidates a resolution; known uncertainty remains
visible. Legacy records get conservative read-only review projections, without
startup rewriting their identities or manufacturing source evidence.

## 9. Migration risks and controls

| Risk | Required handling |
| --- | --- |
| C/C++/C# and other punctuation collisions | Preserve raw available labels and separate new exact identities. A collapsed legacy key is quarantined for identity confirmation, never auto-split. Lost original values cannot be recovered; show this limitation. |
| Last-write-wins key normalization | Preview raw input before normalization; reject conflicting colliding identities in new/import operations. Do not repair an old overwritten value through guesswork. |
| False/zero/No or numeric-vs-boolean confusion | Own-property checks, typed values and strict scalar preservation; no truthiness filters or coercion-based deduplication. |
| Silent widening of old consent/salary/legal scopes | Import as legacy-bound exact entries only. Require explicit context/value confirmation before richer reuse. No automatic conversion to global concepts. |
| Concurrent edits / partial writes | Dry preview carries source digests and expected bank revision; checked commit rejects stale input. Persist bank entries/bindings in one atomic write; do not require an atomic transaction across legacy and bank files. |
| Rollback discarding later edits | Private exact-byte backups and revision/checksum manifest. Restore the bank only when expected post-import state still matches; otherwise preview reconciliation/export instead of overwriting newer data. |
| Changed meanings/drafts | Version descriptors; incompatible versions require review. Preserve existing occurrence identities and retained edits; incompatible cards cannot inherit drafts automatically. |

Migration is optional and explicitly triggered, with no startup migration. Preserve
all legacy values/bytes and keep backups private and out of Git. Orphan answers
with insufficient context remain in the library, visible and usable only under
their existing safe exact rules until confirmed; they are not silently discarded.
Loading old questions/history does not normalize them into new semantic identities.

## 10. One coherent review and recheck workflow

Dashboard Needs attention owns the job-level review list. Answers owns editors.
History owns outcomes. Links share record/review IDs, not three independent copies
of the same problem. Counts derive from full canonical history and distinguish
blocking items from optional advisory items; multiple reasons use one job card.

- Missing/ambiguous answer → view exact question, review source/context, save
  explicitly → readiness recalculates → separate Retry if existing guards permit.
- Changed choices/format → show original answer as context, require a compatible
  confirmed save; never automatically convert or select it.
- Fit-review skip → edit matching settings or inspect job manually. In 3E, a new
  **Recheck fit** command inspects/evaluates the original job without opening or
  filling an application. It cannot answer legal eligibility from screening data.
- Recheck remains below threshold/unknown → retain review and explanations. The
  user may change the existing supported threshold/settings or complete manually;
  there is no per-job score/eligibility override.
- Recheck now passes → display **Eligible for an explicit retry**, not Ready—dry
  run or Submitted. A separate Retry command applies ordinary guards and rechecks
  the live form. No batch inclusion solely from a review decision.
- Unsupported/unusual control → manual job link; saving a value cannot resolve
  adapter support. Uncertain/reserved/submitted → Check LinkedIn; no retry/recheck
  automation that can create another attempt.

3E's narrow inspection claim may accept only the latest unattempted fit-review
record (or its latest review-only successor), with stable numeric job identity,
matching expected revision, no active same-job work, and no protected exact/strong
duplicate. It creates a linked child and preserves the skipped parent. Recheck
uses one frozen snapshot and existing inspection bounds/Stop/global blockers.
Fresh fit-pass completion uses `needs_attention` with a fixed inspection-only
review reason/blocker, not `ready`; an explicit single retry can then follow the
existing guarded claim path. Review/failed outcomes remain attention items. Extend
only the narrow eligibility bridge; never accept arbitrary skipped/expired/
external/hard-rejected jobs as ordinary retries. Restart stays idle.

Acknowledge/defer affects review presentation only. It cannot clear a blocker,
remove uncertainty, alter an attempted timestamp or claim manual submission.
Even resolved high-impact review does not authorize a click. Current policy and
fresh validation decide whether a separately requested continuation is safe.

## 11. Safety invariants

1. No sensitive/uncertain facts inferred from résumé, name, school, location, job
   descriptions, matching profile or incompatible prior answers.
2. Exact explicit answer precedence, source provenance, No/false/zero, employer
   consent boundaries and incompatible-draft isolation remain true.
3. Dry run never submits or consumes a submission attempt; Ready retains its
   verified-dry-run meaning. Recheck is inspection only and not readiness proof.
4. Stop interrupts inspection/form/pacing; durable work remains recoverable.
5. Pacing, cap and exact/strong duplicates are rechecked at the existing guarded
   boundary; reservation persists before the one protected click.
6. Reserved, attempted, unconfirmed or submitted work never becomes retryable
   through review, bank migration, rollback, startup or a new command.
7. Cleanup/global blockers retain their policies; unsupported controls remain
   manual. New interpretation logic cannot bypass fresh browser verification.
8. Saving answers/settings/reviews, polling and startup never start applications.
9. History order/identity/outcomes and canonical question recovery remain intact.
   Informational review decisions are not submission evidence.
10. Token/Host/Origin validation, private storage and bounded inputs apply to new
    commands. Evidence uses plain text rendering; question/job content is data.
11. Diagnostic snapshots remain allowlisted/redacted; review evidence and answer
    values must not be added to those diagnostic exports.
12. Tests use synthetic local fixtures, temporary data and rejecting submission
    guards; no live applications or real applicant answer edits.

## 12. Per-subphase test and verification strategy

| Subphase | Targeted proof required before completion |
| --- | --- |
| 3A | Table-driven supported paraphrases and adversarial near-matches for every family above; negation/compound/unrecognized qualifiers; separate sponsorship times/jurisdictions; zero/false/exact precedence; résumé/profile facts cannot fill screening. Verify grouped drafts/provenance and visible explanations with focused server/UI/form fixtures. |
| 3B | Bank validation, exact vs equivalent/conflict order, employer/job/unknown context, salary units/time/consent scope; entry edit/delete/tombstone behavior; stale revisions, genuine write failures and corrupt bank. Prove identical resolution in readiness, entry and final verification; frozen bank per run; saves never launch; UI retains drafts and typed values. |
| 3C | Synthetic collisions, ambiguous/orphan keys, conflicting raw input, No/false/zero, exact-byte backups, deterministic/idempotent preview, stale preview rejection, crash/write failure and checked rollback. Legacy behavior remains equivalent for entries not explicitly promoted. No inferred recovered identity/value. |
| 3D | Review kinds/evidence/unknowns, stable IDs, decisions cannot clear blockers or change lifecycle; fit-review skipped records join full-history attention including records beyond 200. One card per job, protected duplicates always non-retryable, weak evidence remains advisory, source rendering cannot execute HTML. Answers/History link correctly and diagnostics remain redacted. |
| 3E | Inspection-only path never calls form apply/reserve; wrong/superseded/protected IDs, stale revision and concurrent commands rejected. Passing vs still-review assessments, changed settings, Stop/restart/global/storage failure, preserved parents and manual exclusions. Fit pass offers only a separate single retry; existing cap/pacing/reservation/uncertainty/snapshot guards still hold when that retry is explicitly requested. |

For implementation, add meaningful failing regression tests first, run focused
tests while developing, then relevant unit/API and affected browser suites once
the subphase is stable. Storage/runner guard changes require their regression
suites even when the UI is small. Run the full existing unit/API and browser
baseline before declaring a broadly integrated subphase complete; avoid repeated
full runs without a new failure/change. Save results in the verification record.
No tests, browser runs, live previews or private-data migration occur during this
planning stage.

## 13. Approval boundary and self-review

Recommend approval of this architecture and **3A's scope first**. That approval
permits preparing 3A's bounded written implementation plan; implementation needs
approval of that plan and execution method. It does not authorize 3B–3E. Reinspect
only relevant changes at each later boundary, report implemented files/tests/
limitations/deferred work, and stop after each subphase.

Self-review: checked this proposal against all requested deliverables and the
Phase 1/2 contracts. Optional migration precedes no required runtime dependency;
legacy exact precedence is not replaced by a similarity score; lost keys are not
reconstructed; review is not an override; fit recheck is not an application run;
manual/protected outcomes retain their guards; no future-phase features or paid
services are included. Browser compatibility and unknown employer phrasing remain
practical limitations. All new contracts here are proposals, not existing features.
