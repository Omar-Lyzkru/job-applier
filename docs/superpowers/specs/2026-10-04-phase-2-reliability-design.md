# Phase 2 — Reliability design

## Approval and purpose

The user approved starting Phase 2 after the verified Phase 1 handoff, then
approved this design in chat: reliable forms, recoverable applications, a
non-blocking Needs Attention queue, and specific failures with sanitized
diagnostics. This document makes that design concrete for review. Product
implementation and its detailed implementation plan have not started.

The intended outcome is that eligible jobs reach a verified application review
more reliably, a problem with one employer does not unnecessarily end the run,
and interrupted work can be retried without rediscovery or duplicate submission.
Keep every submission controlled by the user's existing automatic/dry-run mode,
explicit saved answers, current eligibility rules, cap, pacing, and durable guard.
Finish and verify only Phase 2, report its results, then stop for Phase 3 approval.

## Existing behavior and investigated gaps

The app already has atomic local JSON writes and exclusive data-directory
ownership. A durable `submission_pending` reservation becomes `unconfirmed` on
restart. Any `attemptedAt`, submitted outcome, or uncertain reservation prevents
automatic retry and counts toward the application's local-day cap. Those rules
remain in force.

The form adapter assigns temporary numeric DOM markers during discovery. A
LinkedIn control replaced during hydration loses its marker; radio entry and
verification still refer to that old locator. Existing fixtures verify static
covered and hydrated radios but do not reproduce replacement during filling.
This is a demonstrated code weakness and a hypothesis for the reported live
timeout, not proof of the exact cause of that live occurrence.

Ordinary controls are scanned once after upload, so answer-dependent controls
can appear or disappear without another discovery pass. Later input changes can
reset earlier answers. Page advancement currently compares dialog text: an
inline error can look like progress, and a different page with identical text
can look stalled. Inspection exceptions and all adapter pause outcomes currently
end scheduling, including some failures confined to one job.

Pre-submit work and ranked candidates are held in memory. Outcome history and
pending questions are separate writes, leaving a crash gap between them. There
is no targeted resume command or persistent attention projection. The dashboard
history display is limited to 200 records, so it cannot itself be the queue.

Inspection baseline: 140 unit/API tests and 84 form/adapter fixture tests passed
outside the sandbox. Sandbox socket/browser restrictions are environmental
failures, not evidence of a product regression. The implementation must also
verify the complete dashboard-inclusive browser suite.

## Scope and constraints

- Use Node.js 24+, the installed Playwright version, existing local dashboard,
  and atomic JSON store. No new runtime dependency, database, LLM service, API
  key, external job source, or parallel application browser is introduced.
- Extend the existing history file instead of adding a second authoritative
  queue. A database would introduce migration and operational work without
  solving the immediate form and recovery failures more directly.
- Preserve existing saved-answer keys, exact-answer precedence, compatible
  question grouping, source provenance, employer-specific consent, No/false and
  zero values, and unsaved draft isolation. Never infer screening answers from
  the résumé or job-matching candidate profile.
- Intelligent matching remains opt-in and disabled by default. Legacy search
  order remains streaming; enabled matching keeps bounded discovery and ranking.
- Unsupported or ambiguous controls remain explicit blockers. Do not force
  clicks, remove validation, set checked/value through DOM assignment, or choose
  answers by position or opaque option value.
- Submission is one guarded click. No action after reservation, uncertain
  submission, or confirmed submission is automatically retried.
- Tests use synthetic data and local fixtures only. No live application is
  submitted and no real answer is edited during verification.
- Keep private data, snapshots, browser profiles, résumés, and backups out of Git.

## Reliable form contract

Retain the supported native text, email, telephone, number, date, textarea,
select, radio, checkbox, and résumé upload controls. Custom ARIA controls remain
unsupported unless their existing native backing control can be uniquely
identified and operated through its visible associated label. Adding universal
custom-dropdown automation is outside this design; correctly discovering and
blocking such controls is required.

Separate a control's semantic descriptor from its short-lived locator. A
descriptor includes its unmodified question label, normalized answer key,
native type, enclosing group identity, required/read-only flags, date/pattern
constraints, and displayed choice meanings. Punctuation-aware raw labels must
not silently resolve the existing C-family saved-key collision. Résumé document
selectors retain their structural identity and never become screening questions.

Resolve and operate only one uniquely compatible current descriptor. Discovery
markers may be used as temporary handles within a scan. Reacquire after DOM
replacement or mutation using the descriptor and group scope, without borrowing
another question's control. Duplicate questions/choice labels or changed
constraints make the control ambiguous and require attention.

Native radio and checkbox entry uses a uniquely associated visible label when
the input is covered or has zero size. Verify the newly discovered native
checked state and exact displayed option afterwards, including when internal
radio values are identical. A successful click whose input was replaced is
verified against the fresh compatible group. Never make a second toggle if the
desired state is already present. Clear unknown optional prefilled values only
when clearing can be verified safely; otherwise block as today.

Use a bounded fill/rescan process for each page:

1. Discover the current page and resolve explicit answers.
2. Fill or clear one compatible control, verifying its accepted value/state.
3. Wait for relevant control changes and upload/busy state, then rescan. Newly
   revealed required fields use their own saved answers; removed fields do not
   retain stale blockers.
4. Once all current controls are resolved, wait for a 300 ms quiet interval and
   verify fresh required-control coverage and all accepted answers again.
5. Validate visible error messages, native browser constraints, current required
   custom controls, and the verified selected résumé before navigation.

Bound convergence to eight full passes and the configurable per-page action
deadline, default 10 seconds. A loop, repeated answer reset, persistent busy
state, deadline, or ambiguous identity is a structured blocker. Polling and
browser actions check cancellation; short reacquisition waits do not consume an
unbounded series of default action timeouts. Quiet observation is a practical
bound, not a guarantee against arbitrarily late employer scripts.

Preserve unique-filename upload acceptance and selected-document verification.
The application must not rely solely on a previously set `resumeVerified` flag
if the current page exposes a different or missing selected document.

## Page transitions and submission validation

Represent the current page with available progress/page counter, heading and
control descriptors, and a fresh DOM generation. Changing error/status text
alone is not advancement. Different compatible pages with identical text are
recognized when progress or the underlying page/control generation changes.
If no observable evidence distinguishes them, stop with a form-changed blocker
rather than claiming progress.

After Next/Review/Continue, observe page identity, readiness, and validation
together under a bounded deadline. A validation message means the same page is
blocked. Wait through an observed busy state. An ignored safe navigation action
may be retried once only if the same page and same enabled action are still
present, no validation or new control has appeared, and no action is in flight.
Keep the existing 15-page maximum and make Stop interrupt transition waits.

Before submission, freshly verify the page, explicit answers, required controls,
résumé selection, validation, and submit action. The runner's pacing wait may
take longer than a form's quiet interval, so it must call a supplied readiness
validator after pacing and immediately before durable reservation. The adapter
checks readiness again before the single click. A readiness failure before
reservation is resumable; after reservation it remains uncertain and blocks
retry. No dry run reserves or clicks Submit.

## Persistent application lifecycle

History remains the canonical durable application store. Keep existing outcomes
`skipped`, `needs_answer`, `ready`, `submission_pending`, `submitted`,
`unconfirmed`, and `failed` readable. Add `queued`, `inspecting`, `filling`,
`needs_attention`, and `interrupted` for pre-submit work. Presentation may call
both needs-answer and operational blockers "Needs Attention".

New records have an immutable record ID, job identity, application lineage ID,
optional `retryOf`, validated status/phase, timestamps, revision, retry counters,
structured blockers, bounded diagnostics, and pending-question descriptors.
Persist inspected job facts/assessment when they become available; do not store
an entire profile, résumé contents, or duplicate answer-bank snapshot in every
record. Existing answer-match provenance may continue to contain explicit values
inside the private history, separate from sanitized diagnostics.

Persist a job as queued when discovered, before its inspection or form work.
Enabled matching still ranks eligible jobs before applying. Its durable queued
jobs survive a crash during collection or inspection; ranking is recomputed for
selected applications using current preferences. Legacy mode does not gather all
jobs before applying. Deduplicate discovered IDs and active lineage records so
a queued job or attention item cannot be concurrently processed twice.

Store transitions are serialized and checked against the record revision and
allowed predecessor state. Job metadata changes use a validated dedicated
transition; arbitrary patches cannot change identity, remove an attempted time,
or turn an uncertain/submitted record back into retryable work.

Reservation atomically changes the current unattempted application record to
`submission_pending`, sets `attemptedAt`, and checks latest ID/fingerprint
duplicates and cap in the same serialized history mutation. The runner still
rechecks after pacing. Exclude the current unattempted record from its own
duplicate check. Persist reservation before allowing the adapter to click.
An attempt is counted exactly once, not once per lifecycle transition.

On startup, recover reserved records as `unconfirmed` using the existing rule.
Recover unattempted queued/inspecting/filling work as `interrupted`, retaining
its job, phase, and any questions. Recovery never starts applications. A Stop
before reservation leaves resumable work; Stop after reservation keeps the
existing uncertain/confirmed outcome policy. A storage failure pauses processing
and prohibits submission or further tasks until the durable state is reliable.

## Pending questions and legacy compatibility

Persist pending-question descriptors and the resulting blocker/status in the
same canonical history mutation. `questions.json` remains a compatibility
projection for existing grouped-answer screens. Reconcile it at startup and
after outcome transitions, so a crash between files does not lose questions.
Projection failure reports a global storage blocker; a later startup can repair
the projection from durable history.

Do not rewrite old history or answer identities just to adopt the new schema.
Old records without lifecycle metadata are accepted. Old unattempted
needs-answer/failed records and raw pending questions can appear as legacy
attention entries for their job. Where the old reason is insufficient to
classify the blocker, use an unknown pre-submit failure and require explicit
retry. An old record with any attempted time remains non-retryable regardless
of its status. Preserve operational question reasons even if an answer is saved.

Use durable history array order for legacy supersession, not timestamps that can
tie or be incomplete. Legacy raw questions have no attempt identity: associate
conservatively with their exact job and preserve ambiguous provenance. New
pending occurrences include their record/lineage identity. Missing legacy
question details are an explicit unknown blocker, not proof that no answer is
needed. Orphan questions remain visible/editable; no usable numeric LinkedIn job
identity means targeted retry is unavailable. Unknown or operational failures
require an explicit single-job retry to enter targeted resume, not automatic
inclusion in the ready batch. An explicit new search can also rediscover an
unattempted job and recheck it under current rules, preserving Phase 1's retry
behavior. Restart and answer saving never begin either kind of application run.

Derive the latest relevant lineage/job outcome from full history. A later
submitted or uncertain attempt suppresses all older automatic retry actions for
that job or strong duplicate. A later successful dry-run review resolves older
pre-submit blockers/questions for the exact job but does not count as submission,
exclude the job from a future real run, or produce a completed-application claim. A new blocker
replaces superseded occurrences for that lineage without losing earlier history.
Skipped, failed, and unconfirmed outcomes do not prove prior questions were
resolved. A strong cross-ID duplicate prevents another submission but never
erases a different posting's question occurrences.

Saving an answer resolves missing information, not browser acceptance. Attention
readiness uses fresh answer resolution, but entry/unsupported/validation errors
remain visible until a verified retry outcome. Existing question groups and
their immutable draft identifiers continue to operate on raw occurrences.

## Needs Attention and targeted resume

Add a compact Needs Attention panel to the existing dashboard and link it from
Answers/History. It shows job/company, current phase, concrete blocker, associated
question link, last update, retry eligibility/explanation, and the original
LinkedIn job link. Counts come from full history, independently of the latest
200 history rows. Grouped editors continue to live on Answers.

Keep Recent Applications useful when jobs are queued in bulk: choose displayed
history rows by their latest outcome/update time, with stable legacy fallbacks,
while keeping canonical history array order unchanged for conservative legacy
question association. This preserves the existing recent-results purpose; it
does not add the deferred analytics or personal-ATS features.

Provide "Retry this application" and "Resume ready applications" actions with
the same visible dry-run choice as ordinary Start. Saving an answer never starts
a retry. Resume opens original job URLs and reinspects/refills using current
settings and explicit saved answers; it does not restore stale browser DOM or
assume the employer preserved a draft. No new search is needed for targeted
resume. A run captures a fresh configuration/answer/résumé snapshot at its start,
then retains that snapshot for its entire duration.

A token-protected targeted-retry command accepts bounded validated history IDs
(at most 100) and an optional boolean dry-run value. Reject malformed IDs,
duplicate IDs, active-run conflicts, uncertain/submitted/reserved/superseded
records, unresolved required answers, and blockers requiring manual completion.
Eligibility is checked again when each task is claimed and immediately before
reservation, so concurrent commands or changed durable history cannot duplicate
work. A retry creates a linked new record; historical failures are retained.

Current keyword/fit/hard eligibility rules, already-applied checks, cap, pacing,
duplicate guard, résumé checks, and Stop apply to targeted work. Changed settings
can make a previous job ineligible and produce an explained skip. Apply opt-in
ranking to selected eligible applications; keep stable ordering for legacy mode.

Uncertain submissions show "Check in LinkedIn" with no retry action. Unsupported
controls show manual completion instructions and a job link. This phase does not
provide a manual override that clears an attempted time or claims submission
without observed confirmation.

## Failure classification, continuation, and safe retries

Use structured codes instead of scheduling decisions based on message regexes:

| Code | Meaning and scope |
| --- | --- |
| `missing_answer` | Explicit required/unclear answer; local attention |
| `unsupported_control` | Unsupported/ambiguous required or prefilled control; local manual attention |
| `entry_timeout` | Safe answer action could not finish; local attention |
| `entry_verification` | Accepted value differs or identity changed; local attention |
| `validation` | Visible/native form validation remains; local attention |
| `resume_upload` | Fresh résumé acceptance/selection is unverified; local attention |
| `form_changed` | Page/control identity or convergence cannot be verified; local attention |
| `navigation` | Pre-submit navigation or description loading failed; local attention when the browser is safe |
| `network` | Transient transport failure before reservation; bounded safe retry |
| `job_expired` | Job explicitly closed/unavailable; explained skip |
| `already_applied` | LinkedIn shows prior submission; explained skip |
| `external_redirect` | Application leaves supported Easy Apply; local manual attention |
| `login_required` | Sign-in or authentication interrupted; global pause |
| `verification_challenge` | LinkedIn requires identity/security verification; global pause |
| `platform_limit` | LinkedIn reports application/speed limit; global pause |
| `cleanup_failed` | Prior dialog cannot be closed/discarded safely; global pause |
| `browser_unavailable` | Browser cannot launch/stay connected; global pause |
| `storage` | Durable state/projection cannot be saved; global pause |
| `submission_uncertain` | Reservation/click lacks explicit confirmation; never automatic retry |

The adapter returns original local outcome/blockers plus a separate cleanup
result. Preserve both the original failure and a cleanup failure; do not replace
the former's reason. Continue to the next job only after confirmed cleanup or
confirmed safe browser state. Global blockers stop scheduling and preserve the
remaining queued jobs. Unknown errors are conservative: no blind retry and no
next application until browser safety is established.

Transient pre-submit job navigation/inspection may retry twice, with interruptible
1-second and 3-second waits. A safe field action may reacquire once within its
original deadline, checking the desired postcondition before acting. Safe page
navigation may retry once as specified above. Unsupported controls, missing
answers, validation, eligibility, authentication, expired jobs, and platform
limits are not automatically retried. If submission was reserved, retries are
disabled regardless of the error's apparent type. Retry budgets are persisted
for the attempt and bounded; explicit later retry starts a new linked attempt.

## Sanitized diagnostics

Capture diagnostics before cleanup: local attempt ID, phase/page index,
timestamp, code, control types/counts, bounded opaque descriptor fingerprints,
observed transition/busy state, action durations/retry counts, and cleanup result.
The primary history's job and pending-question descriptors supply human-readable
context. Diagnostic collection itself must be bounded and must not prevent
cleanup or turn a failed capture into a successful application.

Save a bounded JSON structural snapshot under private `data/failures/<record-id>/`
when a form can be inspected. Exclude entered/prefilled values, saved answers,
raw page text/HTML, input names/IDs, credentials/tokens, résumé names/paths, and
unfiltered exception/validation text that might echo an answer. Store only
allowlisted structural fields and validation categories. Use opaque control
fingerprints instead of arbitrary employer label text in diagnostic files.
No screenshots are captured automatically in this phase; optional masked
screenshots can be designed later if needed. The user can inspect the sanitized
snapshot through a token/local-host-guarded JSON endpoint scoped to a known
history ID; never accept filesystem paths from the browser.

Cap each snapshot at 64 KB and keep at most 100 recent snapshot directories;
older history retains its code/reason when a snapshot is pruned. Files have mode
0600 and directories mode 0700. Existing profile/history/question storage remains
private and is not replaced by a supposedly sanitized export.

## Component boundaries and expected files

- `src/browser/forms.mjs`: semantic field discovery/reacquisition, exact native
  actions, bounded convergence, final answer/control/résumé verification.
- `src/browser/linkedin.mjs`: step identity, readiness, transition observation,
  typed interruptions, safe navigation retries, original outcome and cleanup.
- New focused application-lifecycle/attention and diagnostic modules: allowed
  transitions, legacy/full-history projection, blocker policy, and allowlisted
  snapshots. Keep these pure where possible and avoid unrelated refactoring.
- `src/store.mjs`, `src/domain.mjs`: backward-compatible states, validated durable
  transitions/claims/reservation, recovery, and pending-question reconciliation.
- `src/runner.mjs`: durable tasks, scoped continuation, selected resume execution,
  bounded retry budgets, current snapshots, and existing submission protections.
- `src/server.mjs`: attention bootstrap, validated targeted-retry command, and
  guarded sanitized diagnostic access.
- `public/app.js`, `public/index.html`, `public/styles.css`: attention actions and
  clear status explanations with existing editor/draft behavior preserved.
- Relevant unit/API/runner/store/forms/adapter/dashboard tests and synthetic
  fixtures; `README.md`, `docs/verification.md`, and the implementation plan.

Exact module interfaces and independently testable task boundaries belong in the
implementation plan written after this specification's review.

## Verification and completion criteria

Add failing regressions before implementation changes, then run focused checks,
the complete `npm test` suite, and `npm run test:browser`. Read their actual
results and verify changed modules' syntax and Git whitespace checks. Keep test
fixtures separate from production data and use an isolated checkout for execution.

Required regressions:

1. Radio replacement before/during label click, identical option values, covered
   and zero-size inputs, ambiguous/new group identities, and cancellation.
2. Delayed appearing/disappearing native/custom required fields and later resets
   of earlier saved values; no Next or reservation with unresolved controls.
3. Inline validation versus real page progress, ignored first safe Next click,
   identical-text pages, persistent busy/convergence limits, and prompt Stop.
4. Résumé selection changes and new fields during pacing; final readiness is
   checked before reservation and uncertainty protects any later failure.
5. Restart during queued/inspection/filling versus reservation; only unattempted
   work is resumable and startup never starts an application.
6. Crash between canonical blocker and question projection, legacy questions,
   superseded failures, successful dry-run resolution, and attention older than
   the displayed 200 history records. Include same-time legacy entries, orphan
   questions, missing blocker details, and success followed by a later failure.
7. Local failures safely continue; challenges, limits, browser/storage failures,
   and failed cleanup stop scheduling while retaining original blocker evidence.
8. Concurrent/repeated retry commands, changed ID/fingerprint/cap during pacing,
   storage failure during reservation, retry-budget exhaustion, and Stop races.
9. Targeted retry uses current answers/preferences but one snapshot per run;
   current filters, already-applied checks, matching defaults, stable ordering,
   dry run, pacing, attempt counts, and uncertain-submit protection all survive.
10. API input/token/origin/path guards, sanitized snapshots containing deliberately
    planted secrets/PII, snapshot size/retention limits, saved No/zero values,
    grouped/retained drafts, unsafe retry actions, and desktop/390px mobile UI.

Use one independent whole-branch review if the previously selected Native
execution method is retained, fix meaningful findings with regressions, and
rerun affected checks. Do not claim universal live LinkedIn support from fixtures.
If a live read-only check cannot establish the reported timeout's exact cause,
state that limitation explicitly in the completion record.

Before delivery, verify the production runner is idle, privately back up its
settings/answers/questions/history, and preserve those files. Startup may perform
the documented history/question recovery/projection; verify every intended change
against the backed-up records rather than expecting all recovered JSON to remain
byte-identical. No answer/config rewrite is allowed. Inspect local attention UI
without starting real applications or changing real answers. Use existing user
authorization for integration/push only after tests and review pass.

Completion requires a Phase 2 summary of implemented behavior, actual changed
files, test results, bugs/limits, review rulings, and deferred work. Then STOP.
Phase 3 needs a new explicit approval.

## Deferred work and practical limits

Phase 3 retains broader context-dependent answer scopes, richer application
review objects, screening intelligence, and application workflows. Collision-safe
saved-question migration is not silently introduced here. Phase 4 retains
multi-résumé routing, structured facts, and tailoring. Phase 5 retains recruiter
outcomes/funnel analytics and expanded personal-ATS history. Phase 6 retains
additional job sources and cross-source opportunities.

Resuming means safely reopening/refilling an original job, not guaranteeing
restoration of the employer's saved draft or original page. Arbitrarily late
conditional changes, unsupported widgets, changed live selectors, authentication,
closed jobs, and platform limits may still require manual attention. A reserved
attempt is deliberately not automatically retried even when a crash may have
preceded its click. These limits must remain visible to the user.

## Specification self-review

Checked scope against the approved four-part design and phase boundary; verified
legacy/ranked ordering, atomic reservation, full-history attention, current answer
snapshots, question reconciliation, failure scope, and diagnostic redaction agree
with each other. Fixed ambiguous resume, dry-run supersession, and post-pacing
validation behavior in this document. No product code or behavior tests have
been written at this specification stage.
