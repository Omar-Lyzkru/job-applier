# Phase 3A Screening Meanings and Explanations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Preserve the previously selected Native execution: root implements the tasks, with one final independent review. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reduce repeated supported screening questions through safe finite matching, and show why an explicit saved answer is usable or needs review.

**Architecture:** Introduce a pure screening descriptor module behind the existing answer-memory interface. Keep the flat answer store and exact-match precedence. Add resolution explanations to bootstrap and the existing Answers cards; do not change the application lifecycle or protected submission path.

**Tech Stack:** Existing Node.js 24+, ECMAScript modules, node:test, installed Playwright 1.62.1, local HTML/CSS/JavaScript and JSON storage. No new runtime dependency.

**Spec:** ../specs/2026-10-06-phase-3-application-intelligence-design.md, especially sections 5–7 and the 3A row in section 12.

**Status:** Plan execution approved by the user’s “continue” on 2026-10-06. Tasks 1–4 are complete and verified. Phase 3A is delivered; Phase 3B remains paused for separate approval. Planning base `2443efd`; include the approved design and this plan in the execution checkout.

## Global Constraints

- Implement and verify only 3A, report results, and STOP. No automatic start of 3B.
- No storage migration, new answer-bank file/editor, review-decision storage or retry command.
- “School, résumé, name, address, matching profile and job description cannot supply unknown applicant screening facts.” Preserve explicit contact profile aliases only.
- “Suggestions never select a control or become a saved value.”
- “C-family legacy resolution remains manual in 3A; new distinct confirmed identities belong to the bank work.”
- “Exact explicit answer precedence, source provenance, No/false/zero, employer consent boundaries and incompatible-draft isolation remain true.”
- “Saving answers/settings/reviews, polling and startup never start applications.”
- “Tests use synthetic local fixtures, temporary data and rejecting submission guards; no live applications or real applicant answer edits.”
- Salary, non-SMS consent, relocation and unfamiliar employer requirements receive descriptions/review explanations only; add no new automatic equivalents for them.
- Authorization, citizenship, sponsorship now, future, combined time and jurisdiction remain distinct; no logical derivation between them.
- Preserve all existing matching defaults, cap/pacing/Stop, durable reservation, uncertainty, strong duplicates, cleanup, recovery and targeted-retry protections.
- Leave `normalizeQuestion`, `savedAnswerKey`, existing saved values and endpoints unchanged. No new global key normalization.
- Runtime remains local, approximately $0/month, with no paid API, cloud service or external data source.

## Review Focus

1. Combined now/future sponsorship must not reuse separate-period answers even when their values agree; pin this in Task 2.
2. A known phrase plus negation, another country, a paid/recent qualifier or an extra skill must not inherit a broader answer; pin this in Tasks 1–2.
3. New explanations must not change stable group/draft identity or silently move an unsaved edit on polling; pin this in Task 3.
4. No/false/zero must stay visible and valid without turning booleans or offered experience ranges into scalar years; pin this in Tasks 2–4.
5. Hostile employer text and uncertain descriptors must render as text, and explanation updates/saves must never trigger applications; pin this in Tasks 3–4.

## Preflight at execution time

- [x] Read applicable repository instructions and the approved spec/plan. Inspect Git state and any source changes since `2443efd`; adjust only material affected interfaces.
- [x] Use superpowers:using-git-worktrees, inspecting attached artifacts first. Reuse a suitable active checkout or create a managed checkout from the reviewed primary HEAD on `codex/phase-3a-screening-intelligence`. Do not restore archived Phase 2 work just to begin 3A.
- [x] Keep the production server/data in the primary checkout. Reuse installed dependencies/bundled test browser only; never link private config, answers, history, questions, résumé or signed-in browser profile into test data.
- [x] Use superpowers:test-driven-development and verification-before-completion during execution. Preserve Native execution; do not dispatch a fresh implementer/reviewer per task. Use one final independent whole-change review as previously selected.
- [x] Run a focused starting baseline: `node --test --test-isolation=none test/domain.test.mjs test/question-groups.test.mjs test/server.test.mjs`. Save results. Historical whole-project baseline is 199 unit/API and 148 browser tests; these are not fresh guarantees.
- [x] Record task completion/results and justified deviations. Do not reread unchanged broad repository areas or run full browser suites repeatedly.

## Shared interfaces and boundaries

Create `src/screening-intelligence.mjs`, importing only pure skill vocabulary helpers
if needed. It must not import domain/store/server/runner/browser modules.

`describeScreening(field) -> ScreeningDescriptor` is the sole classifier export:

```text
ScreeningDescriptor = {
  version: 1,
  intent: string|null,
  concept: string|null,
  qualifiers: { experienceKind?, skill?, educationStatus?, timeScope?, jurisdiction?, purpose? },
  matchPolicy: 'known'|'exact_only'|'manual_only',
  impact: 'low'|'medium'|'high',
  reasonCode: string,
  summary: string
}
```

Fields are optional only when inapplicable; unknown required qualifiers are null.
Finite recognized meanings retain existing intent strings (`school`, `degree`,
`completed-degree`, `current-student`, `graduation`, `skill-years:…`, `sms`,
`us-authorization`, `us-sponsorship-now-future`). New overall-experience intents
are `experience-years:total` and `experience-years:professional`. Separate-period
sponsorship intents are `us-sponsorship-now` and `us-sponsorship-future`.
Unrecognized compound/qualified meanings get no automatic-equivalence intent.

`explainScreeningResolution(field, resolution) -> ScreeningExplanation` consumes
the current domain resolver result; it never resolves, selects or saves an answer:

```text
ScreeningExplanation = {
  version: 1,
  impact: 'low'|'medium'|'high',
  decision: 'compatible'|'confirmation_required'|'manual_only',
  reasonCode: string,
  summary: string,
  qualifierSummary: string,
  sourceQuestion: string|null
}
```

Fixed explanation codes: `saved_exact`, `saved_equivalent`, `profile_contact`,
`explicit_answer_needed`, `saved_answer_needs_review`, `ambiguous_legacy_identity`,
`employer_unknown`, `unsupported_control`. Preserve detailed existing resolver
reasons alongside these summaries; never guess the cause from arbitrary employer
text or treat high impact as proof an answer is missing.

`describeQuestion(field)` retains existing `intent`, `answerKey`, `scope`,
`controlType`, `reviewPolicy` and string `risk`, adding `screening: descriptor`.
Unchanged existing meanings retain byte-equivalent scope/compatibility inputs.
`resolveAnswer(field, profile, answers)` keeps its current fill/missing shape and
provenance; explanation metadata is added by bootstrap, not inserted into its
return object or diagnostics. Group/draft IDs must exclude the new summaries,
impact and mutable resolution metadata.

## Task 1: Pure descriptors and bounded meaning vocabulary

**Files:** Create `src/screening-intelligence.mjs`, `test/screening-intelligence.test.mjs`; modify `package.json` to include the new unit test in its explicit test list.

**Interfaces:** Produce `describeScreening(field)` and the descriptor above. Task 2 consumes its `intent` and `matchPolicy`; Task 3 consumes descriptors and explanations. Keep existing normalization behavior in answer-memory; use private meaning normalization only for finite classification, never to generate saved keys.

- [x] **Step 1 — Write failing descriptor tests.** Table-test every existing recognized intent/template and the following finite additions. Assert qualifier identities and high-impact legal questions independently of their match policy.

| Meaning | Newly admitted complete labels |
| --- | --- |
| Overall total experience | `Total years of experience`; `How many total years of experience do you have?` |
| Overall professional experience | `Years of professional experience`; `How many years of professional experience do you have?` |
| Current degree | `Which degree are you currently pursuing?`; `What degree are you currently studying for?` |
| Completed degree | `What is the highest degree you have completed?`; `What is your highest completed degree?` |
| Student | `Are you currently enrolled as a student?`; `Are you presently enrolled as a student?` |
| Sponsorship now, US | `Do you currently require sponsorship to work in the United States?`; `Do you currently need visa sponsorship for employment in the United States?` |
| Sponsorship future, US | `Will you require sponsorship to work in the United States in the future?`; `Will you need visa sponsorship for employment in the United States in the future?` |

Allow existing NFKC/case/whitespace/trailing required-marker handling and existing
US spelling equivalence only; do not remove arbitrary qualifications. Preserve
all existing skill-year templates and the current reviewed skill allowlist.

```js
assert.equal(describeScreening({label:'Total years of experience'}).intent,'experience-years:total');
assert.equal(describeScreening({label:'Years of professional experience'}).intent,'experience-years:professional');
assert.equal(describeScreening({label:'Do you currently require sponsorship to work in the United States?'}).intent,'us-sponsorship-now');
assert.equal(describeScreening({label:'Years of C++ experience'}).matchPolicy,'manual_only');
```

- [x] **Step 2 — Add negative descriptor cases.** Bare `Years of experience`, paid/recent/full-time/production qualifiers, compound Python-and-Java years, negated student, graduate versus current-student, future student, citizenship versus authorization, Canada versus US, and conditional sponsorship must have no newly reusable intent. C/C++/C# stay distinguishable in qualifiers but all retain manual legacy policy. Salary/currency/period, consent purpose, willingness versus actual location, and unfamiliar compound requirements receive conservative summaries without alias equivalence. Do not add auto-reuse for generic graduate status.
- [x] **Step 3 — Run the new test file and confirm failure:** `node --test --test-isolation=none test/screening-intelligence.test.mjs`. Expect missing module/export or assertion failures proving the new contract is absent.
- [x] **Step 4 — Implement the pure descriptor.** Initially copy the reviewed existing finite vocabulary/raw skill-year rules into this module; replace the old private classifier in Task 2 once its compatibility tests pass. Leave SMS saved-key/scoped-consent handling in answer-memory. Classify narrowly before adding explanations; broad warning detection cannot grant `known` status. Existing aliases are explicitly enumerated, not replaced by token similarity.
- [x] **Step 5 — Run the new tests and existing domain/group tests.** All descriptor assertions pass; existing Phase 1 behavior remains unchanged because resolver integration occurs in Task 2.
- [x] **Step 6 — Commit only the tested descriptor, test and test-list change.**

## Task 2: Safe resolver integration and reuse explanations

**Files:** Modify `src/answer-memory.mjs`, `src/domain.mjs`; extend `src/screening-intelligence.mjs`, `test/screening-intelligence.test.mjs`, `test/domain.test.mjs`.

**Interfaces:** Consume Task 1's descriptor. Produce additive `describeQuestion.screening`, preserve the existing resolver contract, and implement `explainScreeningResolution(field, resolution)` using the fixed codes above.

- [x] **Step 1 — Write failing resolver regressions.** Each admitted label can reuse an explicit same-intent saved label. Exact answers still win over conflicting equivalents; conflicting equivalent values remain missing. Overall/skill-specific and total/professional years cannot mix. Combined sponsorship never derives from now/future entries, and neither separate period borrows the combined answer. Test both directions, same and conflicting booleans, and cross-country/negated/conditional wording. Within each one legal intent, false and No must agree while true and No conflict; agreeing values across different periods still cannot be reused.

```js
const yesNo=[{label:'Yes',value:'yes'},{label:'No',value:'no'}];
const current={label:'Do you currently require sponsorship to work in the United States?',type:'radio',options:yesNo};
assert.equal(resolveAnswer(current,{}, {'will you now or in the future require sponsorship to work in the united states':false}).kind,'missing');
assert.equal(resolveAnswer({label:'How many total years of experience do you have?',type:'number'},{},{'total years of experience':0}).value,'0');
assert.equal(resolveAnswer({label:'Years of professional experience',type:'number'},{},{'total years of experience':2}).kind,'missing');
assert.equal(resolveAnswer({label:'What is your highest completed degree?',type:'text'},{},{'degree type':"Bachelor's Degree"}).kind,'missing');
```

- [x] **Step 2 — Write explanation tests.** A compatible exact or equivalent explicit legal No is high impact but `compatible`, with its original source. Profile contacts use `profile_contact`; profile/resume-derived screening stays missing. C-family and unknown-employer SMS return manual explanations; changed choices/format and conflicts require confirmation. A required checkbox with explicit false remains manual under the existing form rule, without rewriting false or claiming the applicant consented.
- [x] **Step 3 — Run:** `node --test --test-isolation=none test/screening-intelligence.test.mjs test/domain.test.mjs`. Confirm the new reuse/explanation tests fail before integration.
- [x] **Step 4 — Integrate finite intents.** Replace internal classifier calls with the pure descriptor adapter, preserve exact-key lookups/SMS/date handling, and include overall-experience intents in nonnegative finite scalar validation and equivalent numeric comparison. Extend existing boolean answer-meaning comparison to the two new sponsorship intents, within each intent only. Offered ranges remain offered choices, never fabricated numeric years. Sensitive candidate exclusion remains symmetric. Do not add new salary/non-SMS consent/relocation equivalence or infer sensitive facts.
- [x] **Step 5 — Implement explanation mapping.** Derive the decision from the actual resolver result, explicit manual policy and existing required-checkbox restriction. Use fixed plain summaries, preserve detailed resolver reasons separately, and identify compatible source provenance. Keep impact separate from permission to reuse.
- [x] **Step 6 — Run focused descriptor/domain/group tests.** Verify all old legal/education/SMS/format/false/zero/exact-precedence regressions plus new negative cases pass. Ensure unchanged existing `describeQuestion.scope` values keep draft identities stable.
- [x] **Step 7 — Commit the tested integration.**

## Task 3: Bootstrap metadata and existing Answers explanations

**Files:** Modify `src/server.mjs`, `public/app.js`, `public/styles.css`; extend `test/server.test.mjs`, `test/question-groups.test.mjs`, `test/dashboard.test.mjs`.

**Interfaces:** Pending bootstrap questions gain `screeningExplanation`; common-question records gain `description` and `screeningExplanation`. Groups retain enriched representative/occurrence questions. Existing `savedAnswer`, raw question arrays, counts, endpoints and answer editors remain compatible. No new page or mutation endpoint.

- [x] **Step 1 — Write failing API/group tests.** Verify explicit source and actual fill/missing/manual decisions, high-impact compatible legal No, unknown employer, required-checkbox false, numeric zero, format mismatch and hostile labels. Raw stored answers/questions/history are unchanged after bootstrap. Explanation/source/reason edits do not change existing draft IDs, counts or retained operational blockers; truly incompatible controls/scopes still remain distinct.
- [x] **Step 2 — Run:** `node --test --test-isolation=none test/server.test.mjs test/question-groups.test.mjs`. Confirm the additive metadata assertions fail.
- [x] **Step 3 — Enrich bootstrap using the actual resolution already computed.** Call `explainScreeningResolution` before any manual display-type conversion; use original control details for the explanation. Do not recompute answers with a different profile or key. Preserve filtering that removes resolved missing-only occurrences and retains operational failures.
- [x] **Step 4 — Write failing dashboard tests.** Existing cards show a short meaning/qualifier summary and one reuse/review sentence. Detail text exposes the source question and original resolver reason. Polling, unrelated saves and failed saves retain typed drafts; changed explanation metadata alone cannot retarget an edit. Saved false/zero render visibly. Hostile text creates no markup, and reading explanations/saving values calls no runner start/retry function.
- [x] **Step 5 — Run focused dashboard tests with the installed local browser:** `PLAYWRIGHT_BROWSERS_PATH="$PWD/data/browsers" node --test --test-isolation=none --test-name-pattern='screening explanation' test/dashboard.test.mjs`. Expect missing explanation/UI assertions to fail; use this phrase in new test names.
- [x] **Step 6 — Add the existing-card UI.** Use text nodes/textContent through the current `create` helper. Reuse current card/help styles and an expandable explanation detail; add only necessary wrapping styles. Do not display a confidence percentage or present high-impact confirmed answers as missing. Existing editor/manual action/provenance/affected-jobs controls retain their behavior. Do not add common-question save controls for new unscoped salary/legal contexts.
- [x] **Step 7 — Rerun focused API/group tests and the new dashboard cases.** Check synthetic desktop and 390px layouts, keyboard access and no document overflow, without real answers or the signed-in LinkedIn profile.
- [x] **Step 8 — Commit the tested metadata/UI change.**

## Task 4: Form-boundary proof, regression verification and delivery

**Files:** Extend `test/forms.test.mjs`; update `README.md`, `docs/verification.md`, and task checkboxes/results in this plan. Product browser/runner/store code should not need changes for 3A.

**Interfaces:** Consume the existing `fillApplicationFields(dialog, options)` and `verifyApplicationFields(dialog, options)` using synthetic DOM and the integrated resolver. Preserve the existing outcome and diagnostics schemas.

- [x] **Step 1 — Add integration cases.** A synthetic required-radio form contains separate now/future/combined US sponsorship plus an authorization question. Only the explicitly saved matching periods fill; the combined question remains pending. A confirmed No chooses the displayed No option even with duplicated internal values. Include overall professional years zero and a broader conflicting total answer; assert zero survives entry and final verification. Unknown qualified questions and custom controls remain blocking. Never include or click a Submit button in these fixtures.
- [x] **Step 2 — Run focused forms cases:** `PLAYWRIGHT_BROWSERS_PATH="$PWD/data/browsers" node --test --test-isolation=none --test-name-pattern='screening meaning' test/forms.test.mjs`. New tests use this phrase. This is boundary verification of already-tested behavior, so it may pass immediately; unexpected failures require diagnosis before further scope changes.
- [x] **Step 3 — Run whole relevant unit/API tests once stable:** `npm test`. Require zero failures, including runner/store/lifecycle/attention and diagnostic regressions; save the complete output and actual test count.
- [x] **Step 4 — Run the full existing local browser baseline once:** `npm run test:browser`. Require zero failures. Do not append focused filename arguments to this script; it does not forward them. No live preview or submission is authorized for testing.
- [x] **Step 5 — Check syntax of changed JavaScript and `git diff --check`; inspect synthetic desktop/mobile screenshots.** Confirm only 3A files/features changed and private data/artifacts remain ignored. Repeat suites only when a new change/failure warrants it.
- [x] **Step 6 — Request one fresh independent whole-change review under the preserved Native method.** Focus on scope/equivalence, legacy precedence, draft stability, false/zero and unchanged protected submission behavior. Review findings need a scoped regression/fix/retest; no automatic expansion into later subphases.
- [x] **Step 7 — Document actual behavior and results.** Explain supported finite matching, why similar questions may remain separate, and the still-manual C-family/unknown contexts. Record files, counts, review findings/fixes, practical limits and deferred 3B–3E. Do not claim live LinkedIn compatibility from synthetic fixtures.
- [x] **Step 8 — Commit verified 3A changes and complete authorized delivery using the existing session/repository integration rules.** If updating the primary local app, first back up private state and confirm idle/no in-flight work; compare config/answers and history identity/order after startup. Do not edit real answers, trigger a run, force-push, or publish private data. Any unperformed delivery/check remains explicitly reported.
- [x] **Step 9 — Report completion and STOP for approval.** 3A completion is not authorization for 3B.

## Plan self-review and approval boundary

All 3A requirements map to Tasks 1–4; later storage/review/recheck contracts stay
deferred. Task 1 owns the classifier vocabulary, Task 2 owns matching/decision
semantics, Task 3 owns additive metadata/rendering, and Task 4 verifies the live
form boundary and existing safety regressions using local fixtures. Both public
pure signatures and enum/property names are consistent across tasks. The five
review-focus cases have explicit regression owners. No product code, test runs,
dependency installations or private-state changes occurred while writing this plan.

Approval was received before implementation. Native execution is preserved.
Stop after Task 4; 3B requires separate user approval.


### Task 4 verification record

Full unit/API: 208/208. Full browser: 151/151 after reproducing/fixing the
obsolete grouped-card summary selector (initial run 150/151). Focused form
boundary 2/2 and grouped/explanation UI 2/2 passed. JavaScript syntax and
whitespace passed; synthetic desktop/390px screens inspected. Independent
replacement review: no Critical/Important findings; one Minor caution-label
issue deferred, with consent reuse guards verified. The primary app is running
idle at port 3210, and GitHub main matched delivered source revision `2e347cb`.
The integrated primary unit/API suite passed 208/208. Config, answers and all
357 history records stayed unchanged; startup initiated no run. Native Task 4
completion independently recorded another 208/208 unit/API pass. Test logs,
review, ledger and synthetic screenshots (59 files) were privately copied and
checksum-verified before temporary-workspace cleanup. Phase 3A is complete;
no 3B work started. Final delivery consists only of this checklist/documentation
closure and a normal push, followed by remote revision verification.
