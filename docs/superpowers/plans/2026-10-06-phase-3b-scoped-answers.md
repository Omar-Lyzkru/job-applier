# Phase 3B Scoped Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Preserve Native execution: root implements, with one independent final review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save new explicit confirmations with visible job, employer or approved reusable scope, so compatible repeats reuse them without guessing or changing legacy answers.

**Architecture:** Add a private versioned answer bank behind the existing resolver. Atomic revision-checked entry commands and a frozen run snapshot share one compatibility contract with bootstrap, attention, browser entry and final validation. Extend existing Answers cards/library; keep legacy Common questions and their endpoint intact.

**Tech Stack:** Existing Node.js 24+, ECMAScript modules, node:test, Playwright and local JSON/HTML/CSS. No new dependency or paid service.

**Spec:** `docs/superpowers/specs/2026-10-06-phase-3-application-intelligence-design.md`, sections 5–12, limited to 3B. Phase 3A and the separately approved theme/save-display fixes are delivered at `693d612`.

**Status:** The user requested continuation into 3B after the fixes. The user approved this plan with “continue here” on 2026-10-07. Native execution is underway. Stop after verified 3B; 3C requires separate approval.

## Global Constraints

- Implement only 3B. No legacy import/bulk migration/rollback UI (3C), durable unified reviews (3D), fit recheck (3E), résumé rewriting, analytics or platform expansion.
- “Suggestions never select a control or become a saved value.” No screening facts inferred from résumé, profile contact data, job-fit facts or job descriptions.
- “Saving answers/settings/reviews, polling and startup never start applications.” Saving a scoped entry is information confirmation, not retry/submission authorization.
- “Exact explicit answer precedence, source provenance, No/false/zero, employer consent boundaries and incompatible-draft isolation remain true.”
- Legacy `answers.json`, normalization and existing Common questions remain unchanged. Missing bank means legacy-only operation; invalid existing bank is a storage error, never empty success.
- Null/unknown context is never a wildcard. Unsupported controls, unknown employer consent, incompatible choices/formats and unproven sensitive context remain manual/review.
- Preserve cap/pacing, Stop, durable reservation, exact/strong duplicates, uncertainty, cleanup/recovery and fresh final verification. No eligibility override or new lifecycle state.
- Tests use temporary synthetic data and local fixtures. No signed-in browser, real applicant edits or live submissions.
- Preserve delivered Light/Dark preference, current-answer counts, protected-status labels, draft retention and retry/manual distinction.
- Private bank, backups and verification remain under ignored `data/`, with existing owner lock, serialized writes, file permissions and atomic durability.

## Review Focus

1. A scoped exact replacement followed by edit/delete/expiry must not resurrect the old legacy answer for its owned scope; test in Tasks 1–2.
2. Agreeing values across different employers, C/C++/C#, citizenship/authorization or sponsorship periods must never create equivalence; test in Tasks 1 and 3.
3. Concurrent saves or changed source observations must reject stale commands without losing entries/drafts; test in Tasks 2 and 4.
4. A bank change during a run must affect only a later run; entry, final verification and retry claims must use the same compatibility contract; test in Task 3.
5. Saved information cannot make unsupported, uncertain/reserved/attempted or duplicate-protected work retryable; source text and diagnostics must stay safe; test in Tasks 3–5.

## Preflight (after plan approval)

- [x] Inspect Git status/diff/recent commits, this plan, its spec and verification notes. Trust completed ledger tasks; preserve valid partial work.
- [x] Use the native managed-worktree tool with the existing consent/preference, inspecting attachments first. Do not restore an archived earlier phase just to start 3B.
- [x] Reuse installed dependencies and synthetic browser binaries only; do not link applicant data or signed-in profiles. Apply TDD and verification-before-completion.
- [x] Create this plan's Native ledger/workspace; record shared-interface rulings before Task 1. Run `npm test`, record actual count/output and require zero failures.

## Shared contracts

Create pure `src/answer-bank.mjs`; do not import store/runner/browser/server modules.

- `emptyAnswerBank() -> {version:1, revision:0, entries:[]}`.
- `validateAnswerBank(input) -> AnswerBank`: bounded schema, stable UUIDs, nonnegative integer revisions, active/retired states, strict typed scalar values and valid timestamps; reject unknown/inconsistent fields.
- `exactQuestionIdentity(field) -> string`: NFKC/case/whitespace/trailing required marker handling while preserving meaningful punctuation. C, C++ and C# stay different. Never use legacy `normalizeQuestion` for this identity.
- `describeBankQuestion(field) -> {version:1, exactIdentity, descriptor, constraints, context}`: reuse 3A finite meanings; distinguish individually confirmed C-family experience without changing the legacy ambiguity guard. Capture type, required/readOnly, displayed choices, pattern, placeholder/format hints, min/max/step/maxLength, jurisdiction/time/skill/experience/purpose and available consent terms identity. Internal choice values and transient DOM IDs are not answer identities.
- `bankCandidates(field, bank, {now}) -> {exact:Entry[], equivalent:Entry[], owned:Entry[]}`: deterministic applicable candidates and ownership, including retired/stale/incompatible owners, with no newest-entry or narrowest-scope tie breaker.
- Extend `findSavedAnswer(field, legacyAnswers, {answerBank, now}={})` and `resolveAnswer(field, profile, legacyAnswers, {answerBank, now}={})` additively. Existing three-argument results remain compatible; omitted `now` means the current Date, while tests inject it explicitly. Bank provenance adds `entryId`, `entryRevision`, `bankRevision`, `answerScope`; keep raw typed `answer`, source label and current displayed choice meaning.
- Extend `projectAttention(history, rawQuestions, {profile,answers,answerBank,now})` and group compatibility using bank scope/source metadata without changing protected retry policies.

Bank entry: `{id,revision,state,value,sourceQuestion,question,scope,confirmedAt,updatedAt,expiresAt,provenance}`. `question` is the server-derived bank descriptor; `sourceQuestion` preserves the raw observed wording. `scope` is `{kind:'job',jobId}`, `{kind:'employer',employerIdentity}` or `{kind:'concept',intent,qualifiers}`. `provenance` identifies the observed job/record and any explicitly replaced prior exact value digest. Timestamps are server-generated except an explicitly selected future expiry. Retired entries retain ownership/context but are never candidates for filling.

Bounds: at most 2,000 total entries including tombstones, labels at most 2,000 characters, text values at most 10,000 characters; numbers must be finite; booleans and numeric zero remain typed. Do not prune ownership silently when bounds are reached.

Scope rules:

- Default every new confirmation to the exact observed job; reject missing/unknown numeric LinkedIn job identity for automatic job-scoped reuse.
- Allow employer scope only for a known observed employer and a supported finite meaning with all required qualifiers. Employer identity preserves punctuation and does not infer corporate equivalence.
- Allow concept scope only for 3A's reviewed finite meanings and individually confirmed C-family experience. Consent has no global concept scope. Separate total/professional, each skill, each legal jurisdiction/period and current/completed education.
- Unknown/compound wording, salary, willingness and non-SMS consent stay exact job scope in 3B. Record explicitly confirmed units/purpose/context when required; absent or changed required context prevents automatic reuse. Do not infer salary units, legal country, consent purpose/terms or expiry from location or other facts.
- Employer SMS reuse requires the same employer, application purpose and proven wording/terms identity. Unknown employer/terms remain review/manual. Capture available consent context from the bounded question container, never from unrelated page text or by following links.

Resolution order: existing control/context guards → compatible confirmed scoped exact → compatible legacy exact → agreeing compatible bank/finite-legacy equivalents → existing explicit contact profile aliases → missing. Conflicting applicable scoped exact entries require review; scopes have no implicit precedence. A scoped replacement of a prior exact value must show it and receive explicit confirmation. Owned retired/expired/incompatible identities block falling back to that old legacy value in the same scope; they do not suppress unrelated legacy scopes. A changed choice/format/context requires reconfirmation rather than silently bypassing scoped ownership. Required-checkbox false stays manual at the form boundary.

## Task 1: Pure identities, scope validation and deterministic candidates

**Files:** Create `src/answer-bank.mjs`, `test/answer-bank.test.mjs`; modify `package.json` test enumeration. Read 3A descriptor/legacy tests; product resolver integration belongs to Task 3.

**Interfaces:** Produce the pure contracts above and validated `AnswerBank`/`Entry` shapes for Task 2 storage and Task 3 selection.

- [x] Write failing `bank identities preserve punctuation and qualifiers`, `bank candidates require explicit scope and compatible controls`, `retired owners remain visible without supplying values`, and `overlapping scope conflicts are not ranked by recency` tests. Assert `exactQuestionIdentity({label:'Years of C++ experience*'}) !== exactQuestionIdentity({label:'Years of C# experience*'})`; boolean false and numeric zero survive validation unchanged. Unknown scope/version, nonfinite/object values, duplicate IDs, unknown employer and oversized entries reject.
- [x] Add hand-derived negative cases: other job/employer, changed choices/date pattern, missing salary units/consent context, separate sponsorship periods/countries, total/professional years, combined skills, unsupported controls and explicit expiry. A job-exact unfamiliar text question can reuse only its same observed identity/constraints; no equivalent candidate appears for another wording/job.
- [x] Run `node --test --test-isolation=none test/answer-bank.test.mjs`; require the intended missing-module/assertion failures before implementation.
- [x] Implement the pure contracts and scope allowlist. Preserve the old C-family guard; only independently confirmed punctuation-preserving bank identities can be admitted later.
- [x] Run the new tests and existing screening/domain/group suites; require zero failures, then commit the tested deliverable and record Native task completion.

## Task 2: Private bank persistence and revision-checked entry mutations

**Files:** Modify `src/store.mjs`; extend `test/store.test.mjs`, `test/answer-bank.test.mjs`.

**Interfaces:** Produce `getAnswerBank()`, `getRunInputs() -> {config,answers,answerBank}` and `saveBankEntry(command)` / `retireBankEntry(command) -> AnswerBank`. A save command has `expectedBankRevision`, optional `entryId`/`expectedEntryRevision`, validated observed `question`, `scope`, typed `value`, optional `expiresAt`, provenance and explicit replacement confirmation. A retire command requires both current revisions. IDs/timestamps/revisions are generated by the store.

- [ ] Write failing tests: absent bank loads revision 0 without creating a file or changing legacy bytes; a corrupt bank prevents startup; active false/zero values survive reopen; returned snapshots cannot mutate store state; retirement prevents selection but preserves ownership.
- [ ] Test concurrent commands against revision 0: exactly one save succeeds; the other reports stale revision and loses no entry. Editing/deleting an absent/retired entry or stale revision fails. Scope/value changes require a fresh explicit confirmation rather than mutating source identity in place.
- [ ] Exercise genuine pre-rename and post-rename directory-sync failures using the existing store failure-test pattern. Reopen must match durable bank truth; config/answers/questions/history remain byte-identical. Expected previous legacy value digest must still match at commit time before recording a scoped replacement.
- [ ] Run focused bank/store tests and observe RED, then add bank loading/persistence through the existing owner lock, queue, 0600 temp file, sync/rename/directory-sync path. No cross-file legacy write or startup migration. Implement coherent run-input reads on the same queue.
- [ ] Run focused and complete unit/API suites; require zero failures. Commit and record completion.

## Task 3: One resolver and frozen bank across readiness, entry and verification

**Files:** Modify `src/answer-memory.mjs`, `src/domain.mjs`, `src/attention-queue.mjs`, `src/question-groups.mjs`, `src/screening-intelligence.mjs`, `src/runner.mjs`, `src/store.mjs`, `src/browser/linkedin.mjs`, `src/browser/forms.mjs`; extend bank/domain/group/runner/store/forms tests.

**Interfaces:** Consume Tasks 1–2. Runner reads `getRunInputs()` once at launch and clones `answerBank` into every adapter call. LinkedIn passes `jobId`, observed company and frozen bank through every fill/verify call. Raw pending questions preserve observed constraints/context (including limits/readOnly/consent text currently omitted by `questionFor`); final validation uses the same resolver. Retry parent claims carry `expectedBankRevision` and reject a bank edit before claiming rather than mixing revisions.

- [ ] Write failing resolver tests for scoped exact replacement versus legacy exact, legacy exact versus bank equivalent, conflicting overlapping exact/equivalent entries, retirement/expiry/changed controls blocking old fallback only in owned scope, and unchanged profile contacts. An independently confirmed C++ entry must fill its C++ question but never C/C#; collapsed legacy C-family keys still stay manual. Test both false and zero, bank values outside an observed numeric limit/step or text pattern, and C-family explanations: confirmed compatible bank provenance can explain reuse while legacy ambiguity stays manual.
- [ ] Write runner tests editing the bank during inspection and between jobs: every apply uses the launch revision/value; a later run uses the new revision. A stale bank before a retry claim is rejected, with no adapter call/submission reservation. Existing cap, strong duplicates, Stop, dry-run and attempted-state tests remain unchanged and green.
- [ ] Write group/draft regressions: different job/employer scoped targets never share a save destination, while unchanged source/value metadata alone does not erase a compatible edit. Changing target compatibility retains the old draft separately. Readiness and final verification must agree on scoped value, choice meaning and blocking contexts.
- [ ] Write synthetic form tests named `scoped bank`: radio No with duplicate internal values, professional years zero, C++ versus C#, two employer SMS contexts, changed choices/terms/date format, required checkbox false and unsupported controls. Fixtures contain no Submit button.
- [ ] Observe RED, then implement the additive resolver order, provenance/explanations and snapshot/context plumbing. Preserve contact aliases and submission mechanics. Bank source metadata must not enter redacted diagnostics; raw operational blockers/history remain authoritative.
- [ ] Run unit/API suites and focused `scoped bank` form cases using installed local browsers. Require zero failures; commit and record completion. Record the narrow C-family exception as confirmed bank identity, never a legacy reinterpretation.

## Task 4: Guarded confirmation preview and scoped Answers editors

**Files:** Modify `src/server.mjs`, `public/app.js`, `public/index.html`, `public/styles.css`; extend server/dashboard/group tests.

**Interfaces:** Bootstrap adds `{answerBank:{version,revision,entries}, bankQuestion}` to observed pending occurrences. `bankQuestion` includes a stable source reference and allowed scopes; compute it from original observations before manual display conversion. Existing fields/endpoints remain compatible.

New same-origin token-guarded commands (JSON, bounded input):
- `POST /api/answer-bank/preview`: create/update proposal by observed source reference or current entry ID; returns server-derived source/context, scope choices, previous exact value and `sourceDigest` / replacement digest. It writes nothing.
- `POST /api/answer-bank/save`: proposal with `expectedBankRevision`, update entry revision when applicable, `sourceDigest`, typed value, explicit scope and replacement confirmation. Value validation must respect the observed supported control, choices, numeric limits/step and text/date pattern before storing an active entry. Re-read source/previous exact values and reject stale digests with HTTP 409. Never accept arbitrary client-authored descriptors/job/employer/source metadata.
- `POST /api/answer-bank/retire`: entry ID plus expected bank/entry revisions; retirement stops reuse and preserves scope ownership. Existing `/api/answers` remains the legacy contract.

- [ ] Write failing server tests for preview side-effect freedom, derived source/allowlist, typed values, stale bank/entry/source/replacement digests, invalid scopes and cross-origin/tokenless writes. Confirm create/edit/delete writes only the bank and dispatches zero run/retry commands. Stored-source edits remain bound to the entry's immutable observation; scope widening requires explicit new confirmation.
- [ ] Write failing dashboard tests named `scoped answers`: preserve scalar types in the editor (number fields use numbers, checkbox fields use booleans, unchanged entries keep their existing type), display exact wording/job/employer/source/qualifiers and currently applicable saved value, default job scope, explicitly selectable allowed broader scope, preview/confirm before replacing a prior exact value, scoped-library edit/delete and clear retired behavior. Keep legacy Common questions/library usable.
- [ ] Cover rejected/stale saves without losing typed drafts, multiple employers/jobs that cannot share a target, false/zero display, hostile source text, dark/light modes and 390px layout. Saving information must recalculate current unanswered counts without claiming form success or automatically retrying.
- [ ] Observe RED, then implement minimal controls inside existing Answers cards and an expandable scoped library. Use textContent; clear only successfully saved target drafts. Unsupported/unknown required contexts show an explicit manual reason, not a futile automatic-save claim.
- [ ] Run focused server/group/dashboard cases and full unit/API suite. Require zero failures; commit and record completion.

## Task 5: Whole-phase verification, independent review and delivery boundary

**Files:** Update README.md, docs/verification.md and this checklist; fix only verified 3B regressions in their owning files.

- [ ] Run `npm test` and `npm run test:browser`, saving complete logs/actual counts; require zero failures. Inspect dark/light desktop and 390px synthetic scoped-editor screenshots, check changed JavaScript syntax and `git diff --check`. No paid/live service or dependency installation.
- [ ] Request one fresh whole-change review under Native execution. Focus on ownership/fallback, scope ambiguity, source validation, frozen bank consistency, drafts and untouched protected submission invariants. Reproduce/fix Important/Critical findings with RED→GREEN tests and green suites; record Minor findings for later.
- [ ] Record actual files/results, known manual/unsupported limits, reviewer rulings and deferred 3C–3E. Explain that new scoped entries do not import legacy values or start applications.
- [ ] Complete previously authorized integration/GitHub delivery only after clean verification. Back up private data (including bank if present), confirm idle/no in-flight work, preserve legacy bytes and history identity/order/attempt times across startup, and verify local/remote revision. Keep proof private; preserve it before native workspace cleanup/archive.
- [ ] Report verified 3B completion and STOP. No 3C implementation without separate approval.

## Plan self-review and approval boundary

Storage, pure compatibility, run-context plumbing and scoped editing each have a
separate testable task. Every broader scope comes from an explicit allowed
confirmation; missing required context stays review/manual. Source references,
revision names, bank property names and resolver options are shared above and
used consistently. C-family bank confirmation does not promote legacy keys.
Ownership/delete semantics, sensitive qualifiers, stale writes/source changes,
run snapshots and protected outcomes all have regression owners. Import/bindings,
unified review and fit recheck have no task here and remain deferred.

This planning step changed no product code, bank file or applicant values.
Review this plan before execution; preserve Native execution after approval.
