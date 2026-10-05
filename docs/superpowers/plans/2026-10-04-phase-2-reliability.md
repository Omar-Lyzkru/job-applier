# Phase 2 Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user previously selected Native execution; retain it. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete supported Easy Apply forms reliably and make blocked/interrupted applications safely resumable without duplicate submissions.

**Architecture:** Extend the current local JSON history with validated work transitions and derive attention/questions from it. Stabilize the existing native form adapter through semantic reacquisition, bounded convergence and fresh validation. Typed blockers connect form outcomes, safe scheduling, targeted resume, diagnostics, and the existing dashboard.

**Tech Stack:** Node.js 24+, ECMAScript modules, node:test, installed Playwright 1.62.1, existing local HTML/CSS/JavaScript dashboard and atomic JSON store. No new runtime dependencies.

**Spec:** ../specs/2026-10-04-phase-2-reliability-design.md

## Global Constraints

- Finish and verify only Phase 2, report its results, then stop for Phase 3 approval.
- Intelligent matching remains opt-in and disabled by default.
- Legacy search order remains streaming; enabled matching keeps bounded discovery and ranking.
- Never infer screening answers from the résumé or job-matching candidate profile.
- Preserve existing saved-answer keys, exact-answer precedence, compatible question grouping, source provenance, employer-specific consent, No/false and zero values, and unsaved draft isolation.
- Submission is one guarded click. No action after reservation, uncertain submission, or confirmed submission is automatically retried.
- Recovery never starts applications.
- Keep the existing 15-page maximum and make Stop interrupt transition waits.
- Bound convergence to eight full passes and the configurable per-page action deadline, default 10 seconds.
- Transient pre-submit job navigation/inspection may retry twice, with interruptible 1-second and 3-second waits.
- Cap each snapshot at 64 KB and keep at most 100 recent snapshot directories.
- Files have mode 0600 and directories mode 0700.
- Tests use synthetic data and local fixtures only. No live application is submitted and no real answer is edited during verification.
- Keep private data, snapshots, browser profiles, résumés, and backups out of Git.
- No new runtime dependency, database, LLM service, API key, external job source, or parallel application browser is introduced.

## Review Focus

1. A control replaced during label activation must be verified through the new unique semantic identity, without a second toggle or another question's answer (Task 4).
2. Delayed custom required controls and later resets of already-filled answers must not slip through native-only validation or post-pacing submission checks (Tasks 4–6).
3. Legacy question occurrences have no attempt timestamps; same-time history, orphan questions, later failures after success, and full history beyond 200 must remain conservative and visible (Tasks 1–2, 7).
4. A concurrent retry, duplicate/cap inserted during pacing, or failed reservation write must never produce a second click or a retryable reserved attempt (Tasks 2, 6–7).
5. Employer text, validation messages, filenames, exception strings and planted secrets must not leak into diagnostic JSON or path-based endpoints (Tasks 3, 5, 7).

## Preflight and execution

- [ ] Inspect instructions, the approved spec, this plan, and the current Git state. Planning base is `3101427`; the execution branch must include the committed plan and specification clarification.
- [ ] Use superpowers:using-git-worktrees at execution time. Inspect attached artifacts; reuse a suitable active Phase 2 checkout or create a managed checkout named `phase-2-reliability` from the reviewed primary HEAD, on `codex/phase-2-reliability`. Use the skill's Git fallback if the app cannot create/register it. Do not restore the archived Phase 1 checkout for new work.
- [ ] Keep production data/server in the primary checkout. Reuse installed `node_modules`; link only `data/browsers` into an otherwise empty worktree data directory if needed. Do not link config, answers, questions, history, résumés, or browser profile.
- [ ] Initialize this plan's ignored Native workspace/ledger, read task briefs, and record shared-interface checks before Task 1. Read TDD and verification skills as required by executing-plans. Root implements every task; no implementer/reviewer per task. Read-only investigations may be delegated.
- [ ] Run `npm test` and `npm run test:browser`, with full output saved in the plan workspace. Expected baseline: 140 unit/API and 118 complete browser tests, zero failures. The earlier forms/adapter-only baseline was 84/84. Request sandbox exception only if local test sockets/Chromium are blocked; do not change product code to accommodate sandbox restrictions.
- [ ] Execute Tasks 1–8 in order without asking to continue between them. Record decisions and exact test results in the ledger and task checkboxes. Preserve the ledger across compaction; completed committed tasks are not restarted.

Focused browser commands below use `PLAYWRIGHT_BROWSERS_PATH="$PWD/data/browsers"`.
The existing browser script does not forward file arguments; do not use
`npm run test:browser -- <file>` as a focused command. Redirect long outputs to
the Native workspace and read every result/tail. No dependency installation or
script argument forwarding is needed.

## Shared data contracts

New work records retain existing `id`, `job`, `status`, timestamps and outcome
fields; add `lifecycleVersion:1`, `lineageId`, `retryOf:null|string`,
`revision:nonnegative integer`, `phase`, `pendingQuestions:[]`, `blockers:[]`,
`retryCounters:{inspectionNavigation:0,applicationNavigation:0,fields:{},pages:{}}`,
and optional `diagnostic`. New work starts with startedAt/updatedAt set to now,
attemptedAt/finishedAt null. Phases are `discovery`, `inspection`, `form`, `review`,
`submission`, `confirmation`, `cleanup`, and `unknown`. The job ID and lineage
identity are immutable; job facts/assessment may be updated by a transition.
Legacy absent revisions are treated as 0 for an explicit claim, not written back
merely on load. New question occurrences include their record and lineage IDs.

`Blocker` has an allowlisted `code`, `phase`, optional opaque `controlFingerprint`,
and fixed safe summary. Human-readable original question/reason remains in
private history/question context. The codes are the specification's table plus
`unknown` for an unclassified pre-submit failure. Actual scheduling depends on
code, reservation and cleanup/safe-browser evidence, not message regexes.

`ApplyResult` keeps existing outcome/reason/evidence/questions/answerMatches,
adding `blockers`, `cleanup:{confirmed:boolean,blocker?:Blocker}`, and optional
sanitized `diagnostic`. An original failure and cleanup failure coexist.
Pure diagnostic data never contains entered values or arbitrary employer text.

### Task 1: Lifecycle policy and full-history projections

**Files:** Create `src/application-lifecycle.mjs`, `src/attention-queue.mjs`, `test/application-lifecycle.test.mjs`; modify `src/domain.mjs`, `package.json`.

**Interfaces:**
- Produce `makeBlocker(code,{phase='unknown',controlFingerprint=null}={}) -> Blocker`, `blockerPolicy(code) -> {scope,manual,automaticRetry}`, `canTransition(record,nextStatus) -> boolean`, and `ApplicationFailure(code,message,details={}) extends Error` carrying a typed blocker, in application-lifecycle. Scope is local/global/terminal/uncertain; manual is true only for unsupported/manual controls; automaticRetry is navigation or none. Unknown defaults to no automatic retry and conservative interruption handling.
- Produce `projectQuestions(history,rawQuestions) -> Question[]` and `projectAttention(history,rawQuestions,{profile={},answers={}}={}) -> AttentionItem[]`, in attention-queue. Item fields: `recordId`, `job`, `phase`, `blockers`, `questions`, `singleRetry`, `readyForBatch`, `retryReason`, and `updatedAt`.
- Consume existing `resolveAnswer`, `blocksRetry`, and `blockingDuplicate`; do not alter their answer/attempt meanings.
- Extend `statuses` with `queued`, `inspecting`, `filling`, `needs_attention`, `interrupted`; retain all seven old statuses. Version-1 transitions may not move attempted/submitted/uncertain records back to pre-submit work.

- [x] **Step 1: Add failing policy/projection tests and include the new pure test file in `npm test`.** Pin legal transitions, each blocker policy, immutable attempted protections, same-job versus strong-equivalent blockers, raw operational versus missing-answer classification, legacy missing details, orphan questions, same-time/durable-order supersession, exact-job ready/submitted cleanup, later failure after success, duplicate pending provenance, old attention beyond 200, and false/zero resolution. Assert at minimum:

```js
assert.equal(canTransition({status:'unconfirmed',attemptedAt:'2026-10-04T12:00:00Z'},'queued'),false);
assert.equal(blockerPolicy('cleanup_failed').scope,'global');
assert.equal(blockerPolicy('missing_answer').manual,false);
assert.equal(projectAttention(history,questions,{profile:{},answers:{relocate:false}})[0].readyForBatch,true);
assert.equal(projectAttention(unknownLegacyHistory,[],{})[0].readyForBatch,false);
assert.equal(projectQuestions(differentPostingHistory,questions).length,questions.length);
```

- [x] **Step 2: Run `node --test --test-isolation=none test/application-lifecycle.test.mjs test/domain.test.mjs test/question-groups.test.mjs`.** Expected: the new contract/behavior tests fail; existing answer/group tests remain unaffected. Inspect failure reasons before implementation.
- [x] **Step 3: Implement the declared pure contracts and additive statuses.** Queue advances to inspecting, then filling; pre-submit work can end skipped/failed/needs_answer/needs_attention/interrupted as appropriate. Filling can finish ready or reserve submission. Reserved work can finish submitted/unconfirmed only; same-state metadata updates preserve attemptedAt. Terminal outcomes start new linked retry records instead of returning the original to filling. Use durable history order for legacy association. Preserve ambiguous/orphan occurrences; only verified exact-job ready/submitted outcomes retire earlier questions. Attempted equivalence blocks retry but does not erase other postings' questions. Unknown/manual/operational failures never become ready just because a saved answer exists. An explicit new search may rediscover/recheck unattempted jobs; restart, answer save and ready-batch resume do not auto-start unknown work.
- [x] **Step 4: Run the Step 2 command, then `npm test`.** Expected: all tests pass, including Phase 1 answer/fit/duplicate tests. No real data is read or rewritten.
- [x] **Step 5: Commit only this task's files.** Message: `feat: add application lifecycle and attention projections`. Complete the Native task with the Step 2 command and record its result.

### Task 2: Durable work, atomic reservation, and question recovery

**Files:** Modify `src/store.mjs`, `test/store.test.mjs`; consume Task 1 modules. Keep the existing legacy record helpers for existing test seeding/callers.

**Interfaces:**
- Add `store.createWork(job,{parentId=null,expectedParentRevision=null,now=new Date()}={}) -> Record`. New discovery work or a claimed linked retry starts queued; a parent claim is serialized, validates latest eligibility/revision and rejects a concurrent active child. `lineageId` is inherited; parent/child linking is durable in the same history mutation.
- Add `store.transitionWork(id,{expectedRevision,status,phase,job,pendingQuestions,blockers,retryCounters,diagnostic,evidence,answerMatches,now=new Date()}) -> Record`. Only allowed fields change; revision increments once, updatedAt/finishedAt follow state, identity/attemptedAt cannot be removed or changed here.
- Add `store.reserveSubmission(id,{expectedRevision,now,timezone,dailyCap}) -> Record`. In one queued history mutation validate current unattempted state, ID/fingerprint history and cap, then set status/phase/attemptedAt. Exclude only the current unattempted record from its own duplicate check.
- Add `store.reconcileQuestions() -> Question[]` using Task 1 projection, and `store.recoverWork() -> void`. Recovery handles old reservations and new unattempted in-flight work, then reconciles questions. Keep `recoverPending()` compatible for older callers until runner/server are moved to recoverWork.

- [x] **Step 1: Add failing real-store tests using temporary data directories.** Cover valid linked transitions, stale/conflicting parent claims, immutable identities/attempts, load of old seven-state history, one atomic reservation, concurrent same-ID/strong-equivalent reservations, daily cap under concurrent mutations, and write failures before/after reservation. Close/reopen at queued/inspecting/filling/submission_pending; assert only the latter has attemptedAt and recovers unconfirmed. Simulate a crash between canonical outcome and question projection by writing the canonical record, closing before reconcile, then reopening/recovering. Verify config/answers bytes unchanged; operational/orphan legacy questions preserved; exact-job ready/submitted clears superseded questions.

```js
assert.equal((await store.getHistory()).filter(r=>r.attemptedAt).length,1);
await assert.rejects(store.transitionWork(reserved.id,{expectedRevision:reserved.revision,status:'queued',phase:'discovery'}));
assert.equal((await recovered.getHistory())[0].status,'interrupted');
assert.equal((await recovered.getHistory())[0].attemptedAt,null);
assert.equal((await recovered.getQuestions())[0].label,'Relocate?');
```

- [x] **Step 2: Run `node --test --test-isolation=none test/store.test.mjs test/application-lifecycle.test.mjs`.** Expected: new durable-work/reservation/reconcile tests fail against the current store; investigate each expected failure.
- [x] **Step 3: Implement the declared store contracts within existing serialized atomic writes and ownership.** Validate version-1 fields while accepting legacy records. Persist questions with blockers/status in history; reconcile compatibility questions afterwards. Skip unnecessary writes on a no-change projection/recovery. A failed canonical write leaves no permission to submit; a durable reservation remains blocking even if a later write fails.
- [x] **Step 4: Run the Step 2 command, then `npm test`.** Expected: all tests pass, including restart uncertainty, ownership, corrupt-file errors and serialized history. Root-owned code callers still work through compatibility helpers.
- [x] **Step 5: Commit this task.** Message: `feat: persist resumable work and atomic submission claims`. Complete the Native task using Step 2's command.

### Task 3: Allowlisted private failure snapshots

**Files:** Create `src/failure-snapshots.mjs`, `test/failure-snapshots.test.mjs`; modify `package.json` to include the new pure/filesystem tests.

**Interfaces:**
- Produce `buildDiagnostic(input) -> SanitizedDiagnostic` accepting only record UUID, allowed phase/page 0–15, timestamp, control-type counts, opaque hex fingerprints, validation categories, busy/transition state, numeric action/retry durations, and cleanup state.
- Produce `saveFailureSnapshot(dataDir,recordId,diagnostic) -> {available,reference?}` and `readFailureSnapshot(dataDir,recordId) -> SanitizedDiagnostic|null`. Only known UUID paths under `data/failures` are used; UI never supplies a path. Serializer limit is 65,536 bytes and retention 100 snapshot directories. Failures return unavailable without changing application truth.
- Tasks 5–7 consume this contract; no form discovery imports or cycles in the snapshot module.

- [x] **Step 1: Add failing tests for strict allowlisting, malicious strings/paths, files/permissions, size, retention, corrupted/missing snapshots and write errors.** Plant answers, emails, passwords, cookies, employer HTML, validation echoes, résumé filenames/paths and exception text in input fields. Assert none occur in serialized JSON. Assert UUID path rejection, oversized snapshots unavailable, a 101st directory prunes to 100, chmod modes 0600/0700, and pruning leaves independent history/answers untouched. Symlinked snapshot directories/files are neither followed nor pruned; reads/writes report unavailable.

```js
assert.equal(JSON.stringify(buildDiagnostic(inputWithSecrets)).includes('private-test-secret'),false);
assert.equal((await saveFailureSnapshot(dir,'../answers',safeDiagnostic)).available,false);
assert.ok(Buffer.byteLength(JSON.stringify(snapshot),'utf8')<=65536);
assert.equal(snapshotDirectories.length,100);
```

- [x] **Step 2: Run `node --test --test-isolation=none test/failure-snapshots.test.mjs`.** Expected: new snapshot behavior fails because the contracts are absent, then exposes any unsafe/incorrect implementation.
- [x] **Step 3: Implement the declared snapshot contracts.** Allowlist values/categories, bound collection lengths, reject free-text unknown fields, write privately and prune only valid owned snapshot directories. No screenshots or raw HTML/text. Optional diagnostic failure does not replace the original blocker or prevent browser cleanup; core durable-history failure still pauses work.
- [x] **Step 4: Run Step 2's command, then `npm test`.** Expected: all tests pass; no secret appears in snapshots or test output.
- [x] **Step 5: Commit this task.** Message: `feat: add bounded sanitized failure snapshots`. Complete the Native task using Step 2's command.

### Task 4: Semantic native-control reacquisition and form convergence

**Files:** Modify `src/browser/forms.mjs`, `test/forms.test.mjs`, `test/fixtures/modern-screening.mjs`, `test/fixtures/modern-application.mjs`; consume Task 1 blocker types.

**Interfaces:**
- Keep `discoverFields(dialog)` entries and existing `fillApplicationFields(dialog,options)` success shape `{questions:[],errors:[]}`. Add blocker metadata only when blocked, preserving question keys/options/source provenance.
- Add `fieldIdentity(field) -> opaque fingerprint` using raw punctuation-preserving question, type/group scope, constraints and displayed choices; no saved value/DOM marker in identity. Fresh semantic reacquisition must yield exactly one compatible entry.
- Extend fill options with `actionTimeout=10000`, `quietMs=300`, `maxPasses=8`, and optional `onAction({operation,controlFingerprint,retry}) -> Promise<void>`; persist retry counters through Task 5 before a retried action.
- Add `verifyApplicationFields(dialog,options) -> {ok,questions,errors,blockers,signature,safeStructure}` as a read-only fresh check. `safeStructure` contains allowlisted type counts/fingerprints/native validation categories/busy state, without label/value/filename text. Task 5 consumes it for final readiness and diagnostics.
- Retain `validationErrors(dialog,applicationState)` compatibility and fresh résumé selected-document verification.

- [x] **Step 1: Add failing deterministic mutation fixtures/tests.** Extend `modernScreening(options={})` without changing default markup. Options: replace the selected group during native change, replace the next group, reveal native/custom required controls after 150 ms, remove a conditional field, reset an earlier value once, continually reset, and make two identities ambiguous. Expose fixture counters; drive changes through native events, not arbitrary test sleeps. Test saved Yes/No with identical `on` values, covered/zero-size inputs, one toggle after successful replacement, saved/missing school answers, unsupported custom controls, stale blocker removal, quiet interval, eight-pass/deadline bound, Stop during reacquisition, new required controls and changed résumé after prior verification.

```js
assert.equal(await page.locator('#fresh-no').isChecked(),true);
assert.equal(await page.evaluate(()=>window.fixtureState.labelClicks),1);
assert.equal((await verifyApplicationFields(dialog,options)).ok,false);
assert.equal(result.questions.some(q=>q.label==='University name*'),false); // removed conditional
assert.equal(result.blockers[0].code,'form_changed'); // nonconverging fixture
```

- [x] **Step 2: Run `PLAYWRIGHT_BROWSERS_PATH="$PWD/data/browsers" node --test --test-isolation=none test/forms.test.mjs`.** Expected: mutation/convergence/postcondition tests fail on the current adapter. Confirm ordinary hydrated/static radio and upload tests still exercise their intended layouts.
- [x] **Step 3: Implement the declared form contracts.** Treat markers as scan-local handles; reacquire before entry/verification, verify desired state before considering one safe retry, and never force ambiguous controls. Fill known controlling fields before deciding final unknowns, rescan after relevant changes and at quiet/final verification, preserve exact dates/choice meanings. Required unsupported/prefilled controls stay explicit blockers. Check Stop in bounded waits; retain unique fresh upload bytes/selection.
- [x] **Step 4: Run Step 2's command and focused forms/adapter files together.** Command: `PLAYWRIGHT_BROWSERS_PATH="$PWD/data/browsers" node --test --test-isolation=none test/forms.test.mjs test/adapter.test.mjs`. Expected: all pass, including legacy success/needs-answer/upload cases. Any expectation changes must preserve user-visible safeguards and be ledgered.
- [x] **Step 5: Commit this task.** Message: `fix: reacquire changing controls and validate converged forms`. Complete the Native task using the combined Step 4 command.

### Task 5: Structured adapter outcomes, transitions, cleanup and final guard

**Files:** Modify `src/browser/linkedin.mjs`, `src/browser/session.mjs`, `test/adapter.test.mjs`, `test/session.test.mjs`, `test/fixtures/linkedin.mjs`; consume Tasks 1, 3, 4.

**Interfaces:**
- `inspect(job,{signal}={})` keeps details and throws typed `ApplicationFailure` for known interruption/navigation/browser conditions. It never submits.
- Extend `apply(job,{profile,answers,resumePath,dryRun,signal,beforeSubmit,onProgress}) -> ApplyResult` with `onProgress({phase,pageIndex,retryCounters}) -> Promise<void>` and `beforeSubmit({validateReady}) -> Promise<void>`. `validateReady() -> Promise<void>` performs a fresh read-only form check and throws a typed failure; Task 6 calls it after pacing and before reservation. A guard ignoring the parameter still works in fixture tests; the production runner must call it.
- Keep one Submit click and current explicit confirmation strings. Collect sanitized diagnostic structure before cleanup; return original blockers and separate cleanup evidence. `onProgress` rejection is a storage blocker and prohibits further application actions.
- Recognize page identity from progress/headings/control schema and DOM generation. Busy/status/error text changes alone are not new pages. Safe Next retry maximum is one; page cap 15; all waits are cancellable/bounded.

- [ ] **Step 1: Add failing adapter scenarios `identical-text-next`, `ignored-next-once`, `ignored-next-always`, `next-validation`, `next-busy`, form change during guard, résumé change during guard, cleanup failure after a local blocker, and failure to persist progress.** Add `fixture.state.advances` separate from existing `events`, and optional `beforeAdvance` gate awaited by `/events`; always release gates in teardown. Assert exactly two ignored-step clicks when one retry is safe, one click for validation, zero guard/Submit on unresolved changes, prompt Stop, typed global challenge/limit/browser failures, original plus cleanup blockers, and absence of planted secrets in returned diagnostics.

```js
assert.deepEqual(fixture.state.events,['guard','submit']);
assert.equal(fixture.state.advances.filter(a=>a.step===2).length,2);
assert.equal(result.blockers[0].code,'validation');
assert.equal(result.cleanup.confirmed,false);
assert.equal(result.cleanup.blocker.code,'cleanup_failed');
assert.equal(fixture.state.submissions.length,0);
```

- [ ] **Step 2: Run `PLAYWRIGHT_BROWSERS_PATH="$PWD/data/browsers" node --test --test-isolation=none test/adapter.test.mjs test/forms.test.mjs test/session.test.mjs`.** Expected: new transition/cleanup/readiness tests fail; inspect their exact reason and fixture event order.
- [ ] **Step 3: Implement the adapter contract and typed interruption paths.** Distinguish validation from progress, safely observe identical-text DOM replacement, await progress persistence, revalidate before the guard and again before the single click. A reserved/clicked failure remains uncertain; challenges/limits/unsafe cleanup remain global. Preserve original questions/reasons through cleanup and capture only Task 4 safe structure. Native browser ownership/login behavior remains unchanged.
- [ ] **Step 4: Run Step 2's command, then `npm test`.** Expected: all pass. Confirmation timeout, dry run, limits, interruption and profile ownership regressions retain their protection.
- [ ] **Step 5: Commit this task.** Message: `fix: verify application transitions and return scoped blockers`. Complete the Native task using Step 2's command.

### Task 6: Persistent runner scheduling and targeted retries

**Files:** Modify `src/runner.mjs`, `test/runner.test.mjs`; consume Tasks 1–5.

**Interfaces:**
- Preserve `runner.start({dryRun}={})`, `stop()`, `getStatus()`, `openBrowser()`, `waitForIdle()`.
- Add `runner.retry({recordIds,dryRun}={}) -> Status` for 1–100 unique selected records. Only one starting/running command is allowed. Fetch current config/answers/résumé once per run; all tasks share that fresh snapshot.
- Queue work durably before inspection, transition phases through `onProgress`, persist canonical outcomes/questions, reconcile questions, and save returned diagnostic snapshots best-effort. Status adds attention/interrupted counts and run counters without new outcome analytics.
- `beforeSubmit({validateReady})` paces, rechecks current history/cap, calls validateReady, then uses atomic reserveSubmission. After any reservation, force non-confirmed outcomes to unconfirmed and keep attemptedAt. A retry creates one linked record using createWork parent revision.
- Retry transient inspect/application navigation twice with waits 1000/3000 ms, persisting counters before each retry and checking cancellation. Adapter-reported field/page retries have their own one-retry limits; no automatic retry after reservation.

- [ ] **Step 1: Add failing runner tests using the real store and controllable adapter/clock.** Cover queued crash/restart, ranked queue crash before application, local inspection/entry failures continuing only when safe, global/cleanup/storage failures retaining remaining tasks, unchanged legacy streaming/ranked ordering, no automatic resume on startup/answer save, fresh targeted answers/current filtering, one snapshot per run, linked history, unresolved/manual/unknown legacy batch exclusion, new-search unattempted retry compatibility, retry budgets/delays and Stop, repeated/concurrent retry starts, duplicate/cap injected during pacing, validator failure before reservation, state failure after reservation, and uncertain/confirmed records never retried. Replace inspection-halting tests deliberately with local-safe continuation plus global-error counterparts.

```js
assert.deepEqual(clockWaits,[1000,3000]);
assert.equal((await store.getHistory()).filter(r=>r.attemptedAt).length,0); // validator rejected
assert.equal(observed.applications[0].answers.relocate,false);
assert.equal(observed.discoveryCalls,0); // targeted retry
assert.equal((await store.getHistory()).find(r=>r.retryOf===parent.id).lineageId,parent.lineageId||parent.id);
assert.equal((await store.getHistory()).filter(r=>r.job.id==='1001'&&r.attemptedAt).length,1);
```

- [ ] **Step 2: Run `node --test --test-isolation=none test/runner.test.mjs test/store.test.mjs test/application-lifecycle.test.mjs`.** Expected: new durability/targeted/scoped continuation cases fail against the old runner. Verify expected failures rather than relaxing safeguards.
- [ ] **Step 3: Implement the declared runner contract.** Persist work during discovery without changing disabled matching order; ranked work is gathered/inspected before application. Reinspect selected original jobs under current rules, recompute fingerprints/fit, and never use queue membership as eligibility. Distinguish original local outcome from global cleanup/interruption. Optional snapshot failure preserves truth; canonical/projection storage failure pauses. Stop preserves queued/unattempted work and recorded in-flight outcomes.
- [ ] **Step 4: Run Step 2's command, then `npm test` and the combined forms/adapter command from Task 4.** Expected: all pass; caps, pacing, Stop, dry run, duplicates, answer snapshots and Phase 1 fit behavior remain protected.
- [ ] **Step 5: Commit this task.** Message: `feat: resume queued applications with safe scoped scheduling`. Complete the Native task using Step 2's command.

### Task 7: Guarded attention API and dashboard actions

**Files:** Modify `src/server.mjs`, `public/app.js`, `public/index.html`, `public/styles.css`, `test/server.test.mjs`, `test/dashboard.test.mjs`; consume Tasks 1–6.

**Interfaces:**
- Startup calls `store.recoverWork()`; GET bootstrap adds `attention:AttentionItem[]` and `attentionCounts:{total,ready,manual,interrupted,unconfirmed}`, derived from full history, not displayed history slice.
- Select displayed Recent Applications by updatedAt/finishedAt/startedAt with a stable array-order fallback, then limit to 200. Do not reorder canonical history or use display sorting for legacy question association.
- Add token/host/origin-guarded `POST /api/retry` with exactly `{recordIds:string[],dryRun?:boolean}`; reject invalid/duplicate/over-100 IDs and invoke runner.retry. Preserve the existing command authorization boundary and reject active/unsafe eligibility server-side, regardless of button state.
- Add `GET /api/diagnostic/<recordUUID>` requiring the app token and a matching known history record; return the allowlisted snapshot or controlled unavailable/not-found response. Reject encoded separators/traversal and never accept a path or expose private record payload via this endpoint.
- Render Needs Attention on Dashboard with individual retry and resume-ready batch controls; link Answers/History to it. Use original job URLs, current blocker/phase/eligibility explanations and diagnostic view. Saved-answer editors/draft identities remain on Answers. Uncertain/manual items have no Retry button; only resolved or safe single-job pre-submit work is eligible.

- [ ] **Step 1: Add failing server/bootstrap/command/diagnostic tests and a controlled dashboard runner retry stub.** Cover legacy/missing/operational/orphan entries and attention older than 200; an early-created ranked job finishing after 201 later queued records still appearing first in Recent Applications without reordering stored history; exact-job successful supersession; current answer readiness including No/zero; 1/100 valid IDs, duplicates/101/malformed/nonboolean/unknown fields; token/origin/host and active/attempted conflicts; known snapshot access versus arbitrary paths, bad IDs, planted secrets and unavailable files. Update test runner stubs with retry() only where intended.
- [ ] **Step 2: Add failing desktop/390px dashboard cases.** Resolve a missing answer, explicitly retry only its job, and verify save alone sends no run command. Check dry-run value, ready batch membership, busy/polling state, failed-request feedback, operational blockers staying visible, unsafe actions absent, affected question links, unknown legacy explanation, saved values, and unsaved/retained drafts surviving unrelated attention polling. Assert no document overflow; inspect synthetic screenshots.
- [ ] **Step 3: Run `node --test --test-isolation=none test/server.test.mjs`, then `PLAYWRIGHT_BROWSERS_PATH="$PWD/data/browsers" node --test --test-isolation=none test/dashboard.test.mjs`.** Expected: new endpoint/projection/UI cases fail against the current app. Read each result.
- [ ] **Step 4: Implement the declared API and UI contracts.** Do not trigger submissions from answer saves or polling. Show fixed human-readable failure labels and current eligibility, preserving original job/question context. Diagnostics expose only allowlisted snapshots, with independent guards. Client batches at most 100 eligible ready record IDs; server rechecks membership/current snapshot.
- [ ] **Step 5: Run Step 3's commands, then `npm test` and `npm run test:browser`.** Expected: all tests pass, existing Settings/ranking/answer controls remain usable, no mobile document overflow. The existing history table may retain its own contained horizontal scrolling.
- [ ] **Step 6: Commit this task.** Message: `feat: add needs attention and targeted resume controls`. Complete the Native task using `npm test` and record the passing browser command/output in the ledger.

### Task 8: Whole-phase verification, review, documentation, and delivery

**Files:** Update `README.md`, `docs/verification.md`, this plan's checkboxes and any meaningful review findings in their owning files/tests. No later-phase features.

**Interfaces:** Consume all completed task contracts and the Native ledger. Produce the verified Phase 2 application, private synthetic verification artifacts, an integration/delivery record, and the required stop.

- [ ] **Step 1: Run the full `npm test` and `npm run test:browser` suites, changed-JavaScript syntax checks, and `git diff --check`.** Expected: all actual tests pass and no syntax/whitespace errors. Record exact final counts; do not infer them from the plan. Inspect desktop/mobile synthetic attention, diagnostics, saved answers, and retained-draft screenshots.
- [ ] **Step 2: Build a Native review package from this phase's actual base through HEAD and dispatch one fresh whole-branch reviewer on the most capable available model, using requesting-code-review.** Supply spec, plan, ledger/rulings, the five Review Focus lines verbatim and full proof paths. Expected: independent findings or explicit clean review, with declined-to-judge items identified. Re-grade effects, fix Critical/Important findings in one TDD pass, run affected and whole suites, and record all rulings/deferred minors. No second reviewer round or per-task implementers.
- [ ] **Step 3: Document operational behavior and limits.** Explain ready/attention/uncertain differences, individual versus ready-batch resume, current preference checks, safe retries and protected attempts, local sanitized diagnostics, and unsupported/late-changing live forms. Record any unverified live compatibility. Expected: README and verification record accurately describe final behavior and tests; no private applicant answers or screenshots enter tracked docs.
- [ ] **Step 4: Integrate under the existing user authorization only after checks/review pass.** Verify production is idle, privately back up config/answers/questions/history, and preserve needed ignored proof before archiving worktree. If a real run is active, defer restart and report it rather than interrupting. Expected: primary code matches the reviewed branch and configuration/answers are not rewritten.
- [ ] **Step 5: Start/restart the local app and inspect it read-only.** Compare backed-up records against intended recovery/question projections; verify unchanged config/answers, preserved historical records and attempted protections, idle startup, reachable bootstrap, counts and UI. Expected: any history/question changes exactly match documented recovery; no real application or answer edit occurs.
- [ ] **Step 6: Push authorized code/documentation, verify remote commit equals delivered local HEAD, and check private paths are untracked.** Expected: reviewed code is on the user's GitHub and local project, clean tracked working tree, data/diagnostics/backups/cookies/résumés/proof excluded. Preserve synthetic proof/ledger rulings before removing this plan's scratch workspace and archiving its managed worktree.
- [ ] **Step 7: Give the Phase 2 summary and STOP.** Include implementation, files, actual tests/results, bugs/limitations, all Native rulings and deferred minors, and later-phase deferrals. Phase 3 remains paused until explicit approval. Do not call Phase 2 complete if required work or verification remains.

## Deferred work

Broader answer scopes/question intelligence and application review objects remain
Phase 3; collision-safe saved-key migration is not part of this plan. Multiple
approved résumés/facts/tailoring remain Phase 4. Outcomes/funnel analytics and
expanded personal-ATS history remain Phase 5. New sources and cross-source work
remain Phase 6. Universal custom widgets, automatic screenshots, live layout
guarantees and manual uncertain-submission override are outside this design.

## Planning self-review and handoff

Specification coverage was mapped to Tasks 1–8; the five Review Focus inputs have
tests in their owning tasks. Shared signatures, state/phase names, diagnostics,
beforeSubmit validation callback, full-history projections and retry APIs were
checked for consistency. Focused browser commands use the actual installed
harness. The spec's legacy-retry wording was clarified to preserve Phase 1's
explicit-new-search behavior while keeping unknown work out of resumed batches.
Recent-results sorting was clarified to preserve the existing display when
ranked jobs are queued before they finish, without changing canonical association.

This plan contains no product implementation. Native execution is retained from
the earlier user selection. The user must review this written plan before
implementation; after approval execute all tasks without intermediate approval
prompts, then stop at the Phase 2 boundary.
