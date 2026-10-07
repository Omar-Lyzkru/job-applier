# Verification and review

Verified on this Linux desktop with Node 24.21.0 and Playwright 1.62.1.

- `npm test`: 37/37 unit, runner, storage, and localhost API tests pass.
- `npm run test:browser`: 35/35 local Chromium fixture/dashboard scenarios pass.
- Visible Chromium launch and fixture sign-in detection pass.
- Shell/JavaScript syntax and Git whitespace checks pass.
- Desktop and mobile screenshots inspected by the author; no mobile document overflow.

The initial whole-change reviewer found six material issues. One regression-driven fix pass addressed exclusive data ownership, accepted/selected résumé uploads, custom ARIA control discovery, semantic choice matching, persistent operational blockers, and CV screening questions. Each regression failed before its fix. The reviewer reported no minor findings.

Automated tests never contact LinkedIn or submit real applications. A separate live search-only check verified Internship filter selection; live application submission compatibility remains unverified. Unsupported employer controls require manual completion. This build uses Linux abstract sockets for exclusive data-folder ownership within one network namespace; no stale lock-file cleanup is needed.

## Settings update — 2026-10-02

Bare LinkedIn and portfolio addresses now save as HTTPS URLs, including when
the form is submitted with Enter. Invalid links identify the affected field
and leave saved settings intact. Older links remain editable on startup;
résumé-only updates preserve them until Settings is explicitly saved.

Country and state / region use local dropdowns. Changing country clears the
old region. Recognized abbreviations display and save as full names; unlisted
saved locations remain available. The bundled country-region-data snapshot
and its MIT license are recorded in `docs/third-party/country-region-data.txt`.

URL normalization, dropdown migration, and legacy-link compatibility regressions
were observed failing before their fixes. Fresh complete suites pass: 33 unit/API
tests and 20 browser scenarios, with desktop/mobile Settings screenshots inspected
and no mobile document overflow. A separate reviewer identified the legacy résumé
upload regression; it was reproduced and fixed with a dedicated API test. No
other material review findings remain. The user's running server was left in
their terminal; restart it and refresh the page to load the update.

The follow-up typing update replaces the location selects with editable inputs
and local dropdown suggestions. Custom typed countries and states survive saving
and reload. Typing updates state suggestions without erasing the current state;
a committed change to a different country clears it. Country aliases retain the
same region, and recognized abbreviations normalize on commit/save. Both new
typing regressions failed against the old selects before implementation. Fresh
suites pass with 33 unit/API tests and 22 browser scenarios. Desktop and mobile
Settings screenshots were inspected. This follow-up changes browser assets only;
the running app serves them after the page is refreshed.

## Browser session update — 2026-10-02

Closing the tracked LinkedIn tab now opens a replacement feed tab in the same
live Chromium context, preserving other tabs and cookies. Opens wait for pending
navigation and browser closure; simultaneous closes share completion. Failed feed
navigation is retried by a later open. Context close callbacks clear only their
own session references.

All four lifecycle regressions failed before their fixes and now pass. Fresh full
suites pass with 35 unit/API tests and 26 local browser scenarios. A separate
reviewer reported no material findings. A real full-Chromium check with a temporary
profile reproduced external ownership rejection, verified the concise close-and-
retry message, preserved the owner's tab and cookie, and reopened successfully
after the owner closed. No personal browser profile or live LinkedIn was used.

This changes the server's browser code. Restart the app in its terminal and
refresh the dashboard to load it. Saved profile data and cookies are retained;
the fix does not delete browser locks or stop other browser processes.

## Search selection update — 2026-10-02

Settings now offers the six LinkedIn job-search experience categories with
multiple selection and an any/all Include keywords mode. Empty experience
selections retain any level; older saved configurations retain all-keyword
matching. Exclusions continue to reject any matching description.

Experience labels were researched using LinkedIn's official
[experience-level reference](https://learn.microsoft.com/en-us/linkedin/shared/references/reference-tables/experience-level-codes)
and [filter guidance](https://www.linkedin.com/help/linkedin/answer/a507441/filter-and-sort-job-search-results?lang=en).
Those references do not document numeric job-search filter values. A bounded
public guest check did not establish their meaning. The adapter therefore reads
values from LinkedIn's labeled native checkboxes and confirms the exact checked
levels after applying them, before accepting each page's results. It waits within
the action deadline for delayed controls. Missing controls, ignored selections,
and selections widened to other experience levels stop discovery.

Domain, Settings, and adapter regressions were observed failing before their
fixes. A separate reviewer identified delayed-filter rendering and missing
selection confirmation; both were reproduced, fixed, and reviewed with no
remaining material findings. Fresh full suites pass: 37 unit/API tests and 34
browser scenarios. Tests cover all six levels, multiple selection, changed filter
values, delayed controls, popup loading, ignored/widened selections, confirmation
on later pages, clearing selections, and any/all matching with exclusions.
Desktop and 390px mobile Settings screenshots were inspected without overflow.

Live authenticated LinkedIn compatibility remains unverified; browser tests use
local fixtures. This implements the requested experience-selection option.
Restart the server and refresh the dashboard before saving the new settings.

## LinkedIn experience label fix — 2026-10-02

A search-only inspection of the signed-in Job Applier browser reproduced the
reported filter-discovery failure. LinkedIn's native controls have associated
labels containing both visible text and screen-reader text, for example
`Internship Filter by Internship`. The exact label comparison rejected this
duplicated text before applying the filter. The same layout exposed numeric
values 1–6 for the six supported experience categories.

Normalization now collapses the two label parts only when both normalize to the
same name. Mismatched labels retain their original rejection behavior. A fixture
using the observed separate input/associated-label markup reproduced the exact
failure before the fix, then passed for multiple selections and pagination.
Fresh full suites pass: 37 unit/API tests and 35 local browser scenarios. An
independent reviewer found no material issues.

The corrected adapter was then checked against the signed-in live search with
the user's existing Internship preference. It automatically applied `f_E=1`,
confirmed that Internship alone was checked, and returned a result. This was a
search-only check: no application run was started and no application was
submitted. Live employer-form submission compatibility remains unverified.
Restart the app and refresh its dashboard to load the fix.

## Application efficiency and searchable answers — 2026-10-03

The initial history audit found 90 skipped records and no submission attempts.
The current signed-in LinkedIn job page no longer exposed the legacy description
selectors or an H1. Empty descriptions were treated as keyword mismatches, and
optional title lookup added a timeout. Inspection now reads the visible, scoped
**About the job** section, waits for description hydration, and keeps search-card
metadata when optional details are missing. Unreadable descriptions produce an
extraction failure rather than a keyword skip. Tests exclude nested buttons,
hidden text, and related-job keywords, and cover Stop and verification checks.

Live previews revealed further changes in LinkedIn's application flow. The
generic safety reminder has a **Continue applying** text control, while its
**Review job post** button leads away from the form. The adapter follows the
known reminder and waits for application controls to hydrate. Opening and closing
a form permit one bounded retry when an initial click has no effect; submissions
are never retried. Unknown warnings remain pauses. Native dialog cleanup scopes
the application and its known **Save this application?** prompt, whose **Discard**
control is also text. Unrelated messaging dialogs no longer prevent cleanup.

The modern résumé section contains a labelled region, an unnamed native-radio
fieldset, and an **Upload resume** button, with no rendered file input. The
adapter arms the file chooser before clicking that scoped action, uploads the
selected local file with a unique name, and verifies acceptance and selection of
that exact new document. It rejects ambiguous actions, pending or failed uploads,
and old same-named documents. Ordinary CV screening questions and unsupported
controls retain their existing handling. Native checkboxes covered by a visible
control use their associated HTML label and verify the resulting checked state.

Choice questions in **Answers**, including **Phone country code**, now provide
typing with a visible filtered list, click selection, and arrow-key/Enter
selection. Exact typed labels save in their canonical displayed form; partial
labels do not save. The regression exercises the actual localhost API, keyboard
and pointer input, canonical saved labels, and a 390px viewport. Desktop and mobile
screenshots were inspected with no horizontal document overflow.

The runner reports checked jobs, durable submission attempts, confirmed
submissions, missing answers, skips, and failures separately. Inspection failures
stop filtering instead of silently skipping or applying. The existing résumé
reader also now checks the complete legacy DOC signature, preventing renamed
DOCX ZIP content from bypassing its expansion preflight.

A separate signed-in live preview of the Vilo software/data internship matched
the user's saved keyword filters, uploaded and selected the new résumé, handled
the checkbox, and discarded the draft cleanly. It returned **Needs answer** only
for **Phone country code**, with 249 offered choices. Every live preview used
`dryRun: true` and an additional rejecting submission guard. No real application
was submitted; live submission confirmation remains unverified.

Fresh complete suites pass: **60 unit/API tests and 64 browser scenarios**.
JavaScript syntax and Git whitespace checks pass. The separate reviewer found
the nested-description-button regression; it was reproduced and fixed. Modern
form and cleanup regressions were likewise observed failing before their fixes.
Restart the server and refresh the dashboard to load all application changes.

## Latest application blockers — 2026-10-03

The newest run exposed two false failures. Vilo's **Resume uploaded successfully**
alert was collected as a validation error. That exact success message is now
excluded only after the fresh uploaded document is verified and selected. Other
alerts, combined success/error messages, and native invalid fields still block.

GoQuant's loaded contact form contains a persistent SVG progress bar at 20%
beside **1/5 pages**. Readiness previously treated every progress bar as a loader.
The adapter now recognizes a local page counter only when its determinate value
matches the page ratio, and includes it in the stable form snapshot. Busy forms,
upload progress, indeterminate loaders, and unrelated page labels remain pauses.

Both reported failures were reproduced in local browser regressions before the
fixes. Fresh full suites pass: **60 unit/API tests and 70 browser scenarios**.
JavaScript syntax and Git whitespace checks pass. A separate read-only reviewer
found no actionable issues in these scoped changes.

Signed-in live previews with the user's saved setup then reached **Review** for
Vilo and **Needs answer** for GoQuant's English proficiency question. Both drafts
were discarded cleanly. The previews used `dryRun: true` and a rejecting final
submission guard; that guard was never called and no real application was
submitted. Live submission confirmation remains unverified. Restart the server
to load these fixes before starting another run.

## Required résumé selector recognition — 2026-10-03

Ten BGE applications had saved the résumé document selector as an operational
question with a generated radio-group label and PDF filename choices. A live
inspection found the short title **Resume***, which the exact **Resume** matcher
rejected. The matcher now permits a trailing required-field asterisk only on
short Resume/Résumé/CV labels; upload controls, filename-radio checks, and scoped
region boundaries still apply. Ordinary CV screening questions remain separate.

The document radios in this layout have zero width and height with one visible
associated HTML label. The native choice helper now selects the fresh document
through that label and verifies the checked state. Ambiguous labels, failed or
pending uploads, old same-named documents, and Stop retain their blocking behavior.
The required-title and zero-size-radio regressions failed before the fixes.
Fresh complete suites pass: **60 unit/API tests and 72 browser scenarios**.
Syntax and whitespace checks pass; a separate read-only review found no issues.

A signed-in BGE dry preview uploaded and selected the fresh résumé, then returned
seven genuine questions: school, major, expected graduation, position type,
location, department, and address. It discarded the draft without submission.
The ten confirmed bogus local entries and one generated résumé-filename answer
were backed up before removal. The genuine preview questions were saved; profile,
other answers, and all 157 existing history records were preserved. This was a
scoped repair of the verified local entries, not a general question migration.

The updated app was restarted. A browser check confirmed readable question
headings, 31 school choices, and the preserved genuine answer library. The local
server now runs independently of the chat's foreground command session.

## Saved answer memory and common questions — 2026-10-04

Answers now offers a common-question bank for recurring education, location,
address, US work authorization, and US sponsorship questions. Entries remain
blank until explicitly supplied or matched to an existing saved answer. Known
equivalent wording can reuse an answer and display its original question.
Token similarity produces review suggestions only. Conflicting answers,
incompatible offered choices, and graduation date format differences remain
pending. Current and completed education, country, question polarity, and
authorization versus sponsorship are kept distinct.

SMS application-update consent is saved per employer. Marketing, calling,
negative consent, and other unrecognized wording require a separate exact
answer. Unknown employers require manual completion in LinkedIn. No legal or
consent answers are inferred from the résumé or preselected. Editing or deleting
a saved answer removes stale recognized-answer information from the dashboard.
Form fills record the source question only after verifying the entered value;
that provenance survives pending-question cleanup in application history.

A live BGE preview exposed three missed required Yes/No questions. Its fieldsets
have no legend or group label: each native radio repeats the question in its
ARIA label, the nearby exact question heading carries the required asterisk,
and sibling paragraphs provide Yes/No while empty associated labels draw the
circles. Discovery now supports this observed structure and verifies the exact
selected radio even when both option values are `on`. Ambiguous choices,
conflicting explicit group labels, duplicate radio names, mixed custom widgets,
and unrecognized résumé selectors remain named operational blockers. Required
native and ARIA descendants cannot be lost when such a group is unsupported.

The corrected signed-in BGE preview returned exactly the work authorization,
current/future visa sponsorship, and application SMS consent questions with
Yes/No choices. It used a dry run plus a rejecting final submission guard, which
was never called, and discarded the draft without submission. Live submission
confirmation remains unverified.

Common-question, pending-answer, answer-library, and SMS drafts survive polling
and unrelated saves. Choice inputs continue to use unique displayed meanings
rather than internal option values. A suggestion requires explicit selection and
saving. Profile and answer changes retain the existing next-run snapshot policy.

Fresh complete suites pass: **87 unit/API tests and 98 browser scenarios**.
JavaScript syntax and Git whitespace checks pass. Desktop and mobile Answers
screens were inspected without document overflow. Separate read-only review
found required-descendant and mixed-widget guard gaps; both failed before their
fixes and passed afterward. No unresolved review findings remain.

The local app was started with the update after confirming no active run.
Config, answers, pending questions, and history were privately backed up, and
their stored contents were verified unchanged after startup. A browser check
confirmed the existing common answers, blank separate authorization/sponsorship
choices, and employer-specific text message setup.

## Saved answers on pending questions — 2026-10-04

The reported Save issue was reproduced as a display problem. Answers were
durable, but operational pending cards initialized their editors blank and did
not reflect answer changes when the stored pending record stayed unchanged.
Bootstrap now derives compatible saved-answer metadata, including the displayed
choice label, without changing stored questions. Pending cards show that value
and distinguish a saved answer from a LinkedIn entry failure that still needs a
retry. Unsaved drafts retain precedence and clear only after a successful save.
False checkbox answers, numeric zero, and normalized choice labels remain
visible. Incompatible saved choices remain suggestions.

Regressions failed before the fix and passed afterward. Fresh complete suites
pass: **91 unit/API tests and 103 browser scenarios**. Coverage includes Save
followed by immediate refresh and reload, changes through Common questions,
unrelated draft preservation, canonical choice labels, false/zero answers, and
rejected saves retaining both the draft and previous durable answer. Syntax and
Git whitespace checks pass; desktop and mobile screenshots were inspected
without overflow. Independent review found no remaining issue in this scope.

The idle local app was restarted with private backups. Config, answers, pending
questions, and history were verified byte-for-byte unchanged after startup.
The updated bootstrap exposes saved-answer values for all 35 currently visible
pending cards and retains all 19 saved answers. This change does not group
repeated cards or repair the separate live LinkedIn radio-entry timeout.
The final read-only browser check confirmed populated pending fields and the
saved-answer/retry status on the running app; no answers or applications were
changed during that check.

## Phase 1 — Intelligence — 2026-10-04

The approved phase adds opt-in local job ranking and explicit saved-question
recognition. Matching collects one bounded scan before applying, distributes
discovery across validated family/region queries, assesses evidenced requirements,
and orders eligible candidates by fit, freshness, then discovery order. Unknown
required facts remain review cases. Strong repost suppression requires known
company/title/location and the same description; attempted history is checked
again after pacing and before reserving Submit. Legacy streaming mode, daily
caps, dry runs, Stop, reservation, and uncertain-submission guards retain their
existing behavior.

Compatible pending questions now share one editor while every original label,
job link, blocker, and failure reason remains available. Group compatibility
respects control, displayed choices, formats, constraints, employer/skill scope,
and saved resolution. Draft identity excludes changing answers, provenance,
reasons, membership, and order. Splits require explicit draft targeting;
incompatible changes retain edits separately. Saved No and zero values stay
visible, and a rejected save keeps both the draft and prior durable answer.
Current-student and finite skill-years aliases reuse only explicitly saved
answers. Sensitive generic suggestions are excluded in both directions;
ambiguous old C/C++/C# experience keys require manual confirmation.

Fresh workstream verification on Node 24.21.0 / Playwright 1.62.1:

- `npm test`: **140/140** unit, API, storage, parser, scoring, grouping, and runner tests.
- `npm run test:browser`: **118/118** local Chromium adapter, forms, and dashboard scenarios.
- Focused dashboard run: **34/34**, plus the final desktop/mobile fit-layout check.
- Changed JavaScript syntax and Git whitespace checks passed.
- Synthetic Settings, fit, grouped-question, saved-answer, and retained-draft
  desktop/390px screenshots were inspected without horizontal document overflow.
  History retains its existing horizontally scrollable table on small screens.

Product changes are in `src/skills.mjs`, `src/job-parser.mjs`,
`src/intelligence-config.mjs`, `src/search-profiles.mjs`,
`src/job-intelligence.mjs`, `src/job-duplicates.mjs`, `src/question-groups.mjs`,
and the existing domain, runner, LinkedIn adapter, answer memory, résumé keyword
wrapper, bootstrap API, and dashboard assets. Tests extend the existing domain,
store, server, runner, adapter, dashboard, and LinkedIn fixtures and add
`test/job-intelligence.test.mjs` and `test/question-groups.test.mjs`.
`package.json` enumerates the new pure tests; README explains the new controls.

All verification used synthetic applicant information. No live applications
were submitted or real stored answers edited. The score is a deterministic
English-language rubric, not a hiring probability; ranking covers only the
bounded scan. Fixture success does not prove every live employer layout.
LinkedIn radio-entry timeouts, conditional forms, persistent recovery/attention
queues, and collision-safe stored-question migration remain deferred to Phase 2
or later. Phase 1 does not repair those separate browser-entry failures.

The fresh independent whole-branch reviewer found five Important issues and
no Critical or Minor issues. One root fix pass reproduced every finding before
changing production code: unsectioned legal restrictions, applicant experience
hidden by team wording, preferred-section minimum experience, incomplete
geography creating false reposts, and unpaid leave mistaken for an unpaid role.
An additional regression prevents explicitly waived citizenship requirements
from becoming restrictions. The parser/runner regressions passed after their
fixes, and the complete suites verify the final integration.

Rulings retained from the review:

- Live selector coverage, radio-entry timeouts, conditional rescanning, and
  recovery stay within the approved later-phase boundary. Cost if wrong:
  live employer forms can still block applications pending Phase 2.
- General collision-safe saved-key migration and C/C++/C# wording outside
  the finite recognized templates remain deferred. Cost if wrong: other
  ambiguous language questions still need manual care until later work.
- The reviewer set final documentation and local/GitHub delivery aside for
  the root to verify directly. Cost if wrong: local or remote copies could
  remain outdated; startup, stored-data comparison, and remote revision checks
  are required before delivery is reported.

Deferred minors: none.

Delivery: the tested branch was fast-forwarded into the clean primary `main`
checkout. Its unit/API suite passed **140/140** again. With the local server
stopped and no pending submissions, config, answers, questions, and history
were backed up privately and verified byte-for-byte unchanged after startup.
The updated bootstrap retains all 19 saved answers and 54 stored occurrences;
35 visible occurrences form **5 compatible cards across 13 applications**.
All visible occurrences retain saved values and usable job context. A read-only
browser check confirmed the five cards, expandable job-specific entry failures,
saved choices, and the matching controls (off by default; minimum 70).
No settings, answers, or applications were changed during the live check.
The `~/Projects/job-applier` link continues to use this primary checkout.
The authorized public GitHub main branch was pushed and its revision matched
the local checkout. Private data, backups, screenshots, test artifacts, cookies,
and résumés remain excluded from Git. Phase 1 is complete; Phase 2 requires
fresh approval.

## Execution record

# SDD ledger — plan: docs/superpowers/plans/2026-10-01-linkedin-easy-apply.md

Execution: Native, approved by user GO AHEAD. Base: 19c4fe5.
Baseline: only committed spec/plan; clean checkout; no app/tests/dependencies yet.
Pre-flight 1→2: Config/Field/resolveAnswer match browser adapter contract; clean.
Pre-flight 1,2→3: Store methods and Adapter apply/beforeSubmit match runner; clean.
Pre-flight 1,3→4: Store and Runner methods match HTTP app; clean.
Pre-flight 4→5: API routes match dashboard; clean.
Ruling: Native worktree tool cannot create a checkout for this projectless chat (Not a git repository) — created a CLI worktree from the requested Job Applier repository under work/ — cost: app worktree metadata is managed through Git, not the app UI.
Task 1: complete (commits 19c4fe5..b9dcdaa, tests: npm test → ℹ duration_ms 188.468329)
Task 2: complete (commits b9dcdaa..34b51f5, tests: npm run test:browser → ℹ duration_ms 9529.520454)
Task 3: complete (commits 34b51f5..10cbce0, tests: npm test → ℹ duration_ms 499.851999)
Task 4: complete (commits 10cbce0..7f09875, tests: npm test → ℹ duration_ms 387.889139)
Task 5: complete (commits 7f09875..c1b0a77, tests: npm run test:browser → ℹ duration_ms 7715.726381)
Final review: fresh whole-change reviewer (gpt-6-astra high); six Important findings, zero Critical/Minor; one TDD fix pass.
Final: fixed exclusive data-directory ownership — data-directory ownership rejects another process and survives abrupt owner death without losing history RED→GREEN, suite 28/28 unit and 15/15 browser.
Final: fixed accepted résumé selection including same-filename replacements — delayed same-filename upload waits for acceptance and selects the new document; upload that never becomes an accepted selected document blocks submission RED→GREEN, suite 28/28 unit and 15/15 browser.
Final: fixed undiscovered ARIA controls with hidden native backing inputs — custom required or selected answer widgets with hidden backing inputs block submission RED→GREEN (checkbox, radio, listbox, combobox), suite 28/28 unit and 15/15 browser.
Final: fixed opaque option values overriding semantic answers — choice answers match displayed meanings rather than opaque internal values RED→GREEN, suite 28/28 unit and 15/15 browser.
Final: fixed hidden operational blockers — pending operational blockers remain visible after their answer is saved RED→GREEN, suite 28/28 unit and 15/15 browser.
Final: fixed résumé keywords misclassifying screening radios — CV screening radio question uses its explicit saved answer RED→GREEN, suite 28/28 unit and 15/15 browser.
Final: Ruling: exclusive process ownership — use Linux abstract sockets on this Linux desktop, with automatic crash release and canonical-directory identity — cost: this build is Linux-only and its ownership scope is one network namespace.
Final: Ruling: exact current live LinkedIn selectors/confirmation wording set aside by reviewer — account is not configured; fixtures prove local behavior and README states live compatibility is unverified — cost: live layout changes may block applications and require adapter maintenance.
Final: Ruling: universal employer widget support set aside by reviewer — supported native controls work; visible unsupported required or selected ARIA widgets block submission — cost: some jobs require manual completion.
Final: Ruling: visual polish set aside by reviewer — author inspected desktop and mobile screenshots and verified no mobile document overflow — cost: visual preference changes remain the user's decision.
Final: deferred minors: none.


## Phase 2 — Reliability (2026-10-06)

Implemented additive durable application states, revision-checked transitions,
atomic retry claims and post-pacing submission reservations. Startup preserves
unfinished work as interrupted and reserved attempts as uncertain. Required
question projection and attention use full canonical history, with conservative
legacy/orphan handling; display sorting never reorders that history.

Forms reacquire unique semantic controls after replacement, verify displayed
choices and selected résumés, rescan delayed conditional controls and earlier
resets, and stop within bounded convergence/action/navigation limits. Adapter
progress is saved before entry. Page transitions require fresh state; final
read-only validation occurs after pacing and before the protected Submit click.
Typed local failures can continue only after confirmed cleanup. Unknown/global
conditions and failed cleanup halt. Temporary pre-submit network retries are
bounded; protected submissions cannot be retried automatically.

The runner supports explicit single-job retry and a ready-only batch of at most
100, preserving one config/answer/résumé snapshot and applying current filters,
ranking, cap, pacing, duplicate and Stop rules. Retry claims retain historical
parents. Saving answers and polling never launch work.

Dashboard Needs attention exposes full-history counts, last update, blocker,
phase, original job links, eligibility and guarded diagnostics. The token/origin/
host boundary is enforced independently for retry and diagnostic access. A UUID
is mapped to a known record and fixed snapshot path; malformed/traversal paths
are rejected before URL normalization. Diagnostic schemas exclude private values
and arbitrary text, are limited to 64 KiB, use private permissions and keep at
most 100 owned snapshots. Missing/corrupt/unwritable snapshots do not alter
canonical state.

Verification before the independent final review:

- `npm test`: **196/196** unit/API/storage/lifecycle/diagnostic/runner tests.
- `npm run test:browser`: **145/145** Chromium adapter/forms/dashboard scenarios.
- Focused server: **33/33**; dashboard **36/36** plus **1/1** last-update and
  guarded diagnostic scenario. New tests were observed failing before changes.
- Syntax checks passed for **22** changed JavaScript files; branch whitespace
  checks passed.
- Synthetic desktop and 390px screenshots of attention, diagnostic JSON,
  saved answers and retained drafts were inspected. No horizontal document
  overflow; History keeps its contained horizontal table scroll.

The tests cover genuine file-write failures, concurrent reservation/claims,
Stop during collection/navigation, conditional native/custom controls, replaced
radio groups without a second toggle, same-text fresh pages, ignored/busy Next,
post-pacing late controls, selected-résumé changes, employer validation versus
successful upload notices, unknown/challenge failures, failed cleanup, answer
No/zero, raw pending projections, older-than-200 attention, outcome-time history
sorting, ready-batch snapshots, endpoint guards and planted diagnostic secrets.

Changed production files: `src/application-lifecycle.mjs`,
`src/attention-queue.mjs`, `src/failure-snapshots.mjs`, `src/store.mjs`,
`src/domain.mjs`, `src/runner.mjs`, `src/server.mjs`, `src/browser/forms.mjs`,
`src/browser/linkedin.mjs`, `src/browser/session.mjs`, `public/app.js`,
`public/index.html`, `public/styles.css` and `package.json`. Tests changed in
`test/adapter.test.mjs`, `test/application-lifecycle.test.mjs`,
`test/dashboard.test.mjs`, `test/failure-snapshots.test.mjs`,
`test/forms.test.mjs`, `test/runner.test.mjs`, `test/server.test.mjs`,
`test/session.test.mjs`, `test/store.test.mjs` and the LinkedIn/modern-screening
fixtures. README and the approved Phase 2 plan record behavior and completion.

All application checks used synthetic fixtures. No live LinkedIn application
was submitted and fixture success is not a live compatibility guarantee. Unknown
or unsupported controls, adversarial late changes and verification can still
require manual care. General question-scope/key migration remains Phase 3,
multiple résumés/tailoring Phase 4, analytics Phase 5 and new sources Phase 6.
Uncertain submission override and universal custom-widget support are excluded.

The fresh independent reviewer found four Important issues and no Critical or
Minor issues. One correction pass reproduced each before changing code:

- Disappearing document choices while an upload region remains now block final
  readiness and post-pacing reservation; hidden/aria-labelled choices still work.
- After rename, in-memory state follows the committed file even if directory
  sync fails. The error still aborts the operation; recovery preserves the
  reservation and attempted timestamp rather than writing stale pre-submit state.
- Unconfirmed/reserved attempts remain in full-history attention after a later
  rediscovery skip or dry run, with their original record and disabled retry.
- Validated page-counter advancement identifies a fresh page even when heading,
  control and button nodes are reused. Reset answers are filled again while
  unchanged-page errors, employer validation and loading remain blocking.

Final corrected verification: **199/199** unit/API and **148/148** browser tests,
with no failures, cancellations or skips. Syntax checks for all 22 changed
JavaScript files and whitespace checks passed. No second review was dispatched;
all four findings have RED→GREEN coverage and the full suites passed.

Native rulings carried through delivery:

- Scoped approved writes in the managed checkout avoid altering the primary app;
  cost if wrong: permission overhead.
- Just-completed full verification is reused when source is unchanged; cost if
  wrong: an unnoticed concurrent edit could weaken that evidence.
- Ordinary loading failure is local after confirmed cleanup; cost if wrong:
  other jobs might continue during a wider platform problem. Unknown/challenge
  and failed cleanup still halt.
- Live compatibility and the original live timeout cause remain unverified;
  cost if wrong: live forms still need manual completion.
- Universal widgets and broader answer migration stay deferred; cost if wrong:
  unsupported/ambiguous questions still require manual care.
- Root inspected functional desktop/mobile screenshots; subjective styling was
  outside independent review. Cost if wrong: visual preferences may remain unmet.
- Production migration/restart/GitHub delivery are verified by the root before
  completion; cost if wrong: stored data or local/remote code could differ.

Deferred minors: none.

Production integration: the clean primary `main` checkout was fast-forwarded to
the verified branch. A private backup of config, answers, questions and history
was created under ignored `data/backups/` before startup. The merged primary
unit/API suite passed **199/199**. The app started idle at port 3210 without
launching an application run.

Startup comparisons confirm config and answers are byte-for-byte unchanged,
historical identities/order and protected attempts are preserved, and questions
match the documented full-history projection. No records needed lifecycle
recovery on this delivery. Read-only primary UI checks passed for attention,
Answers/History links, lifecycle labels, 390px layout and continued idle state.
No applicant answers were edited and no live applications were submitted.

GitHub `main` was pushed and its remote revision matched delivered local HEAD.
Private runtime data, diagnostics, backups, browser files and proof remain
untracked. Synthetic verification screenshots, logs, the review and Native
ledger were copied privately and checksum-verified before scratch cleanup.
Only documentation/checklist changes followed the verified source commit.
Phase 2 is delivered; Phase 3 remains paused for explicit user approval.


## Phase 3A — Screening meanings and explanations (2026-10-06)

Tasks 1–4 are complete, verified and delivered on primary/GitHub `main`. The implementation range starts at `c0b2bb0`.
Pure reviewed screening meanings preserve existing exact keys and scope, add
explicit overall total/professional years, selected education/student aliases,
and separate US sponsorship now/future intents. Combined sponsorship cannot be
derived from separate periods. No bank, migration, new retry command or
submission-path change was introduced.

Saved-answer explanations use actual resolver output. Bootstrap is additive;
existing Answers cards show meaning/source/review reasons using plain text.
Source matching, No/false/zero, scoped SMS, C-family manual handling, operational
blockers and immutable draft compatibility remain intact. Initial synthetic
baseline passed 73/73. Descriptor/domain/groups passed 46/46; server/groups
passed 41/41; new dashboard test passed 1/1; form boundary tests passed 2/2.
The full unit/API suite passed 208/208.

The first full browser run passed 150/151. Its sole failure was an obsolete
unqualified `summary` selector in the grouped-card test: adding the approved
Why this answer disclosure intentionally provides two summaries. The failure
was reproduced before scoping the test to Affected applications; the focused
grouped-card and screening UI cases then passed 2/2. The full browser rerun passed **151/151**. Changed JavaScript syntax and whitespace checks passed; synthetic
desktop and 390px screenshots were inspected without document overflow.

The first reviewer launch hit a model usage limit before returning findings.
The replacement independent read-only review found no Critical/Important issues
and one Minor; no completed review was repeated. Root confirmed the Minor:
“May we send you text messages about your application?” is recognized as SMS
but lacks the high-impact caution. Its employer-scoped No resolves correctly,
and another employer remains missing. This display/impact-label issue is deferred
under the Native review policy; consent/reuse guards are unchanged. Primary integration, private-state comparison and GitHub delivery are verified.
GitHub main matched the delivered source revision `2e347cb`; only checklist
and verification documentation follow that revision. No live applications or
real applicant answer edits were made during testing. Phase 3B remains paused.


Review rulings:

- The grouped-card test now targets Affected applications explicitly because
  Why this answer adds a second disclosure; cost if wrong: affected-job detail
  expansion would be untested.
- Scoped bank/migration/unified review/recheck remain 3B–3E; cost if wrong:
  legacy scope/collision and fit-review workflow limits persist.
- Live LinkedIn compatibility was outside synthetic review; cost if wrong:
  changed real employer layouts may still require manual attention.
- Root owns private-state and local/remote delivery checks; cost if wrong:
  applicant state or deployed code could differ.
- Root owns the completed browser baseline and delivery documentation; cost if
  wrong: an unverified regression or incomplete delivery could be missed.

Deferred minor: one SMS wording lacks the caution note; it does not bypass
employer scope or change automatic answer selection. New bank storage/migration,
review objects and fit recheck remain deferred. Only deterministic local logic
was added; no runtime dependency, paid service or live submission was introduced.


Local delivery: clean primary main was fast-forwarded to the reviewed branch.
The integrated primary unit/API suite passed **208/208**. Before startup, an
ignored private backup confirmed no unfinished application states. The app
started idle at http://127.0.0.1:3210/ and stayed idle during read-only bootstrap.
Config, answers and history remained byte-for-byte unchanged; all 357 history
identities/order and attempted times are preserved. Questions match the
canonical full-history projection. All 11 common-question records and six
visible pending groups expose versioned explanations. Startup made zero run
attempts. No real answers were edited or live applications submitted.

Native Task 4 completion recorded a final **208/208** unit/API pass. The
plan-specific ledger, review, test logs and synthetic screenshots were copied
to ignored private verification storage; all 59 copied files were checksum-verified
before removing the temporary scratch workspace. Private backup and startup
proof remain local. Phase 3A is complete. Stop here; Phase 3B needs separate
user approval.


## Theme switch and saved-answer display fix (2026-10-06)

User approved the bounded design before implementation. The synthetic save
reproduction returned HTTP 200 and a persisted answer while retaining an
operational question count and historical needs_answer label. The primary
read-only diagnosis also found existing explicit answers resolving all projected
questions; entry/verification failures were the visible retained cards.

The sidebar now switches Light/Dark mode and stores only the appearance choice
in this browser. An early same-origin script applies it before styles; denied
browser storage still permits switching for the current page. Desktop/390px
screenshots were inspected; dark card and save-feedback contrast are tested.

Bootstrap adds answerStatus/answerStatusCounts and attention answerProgress
without changing existing questionCounts, storage keys, saved values, history
or retry eligibility. Questions are separated into needs-answer, saved/retry
and manual groups. Only unresolved answer information contributes to the
Questions to answer count. Historical outcomes remain unchanged. Uncertain,
reserved, active and duplicate-protected work keeps its status and does not
receive retry guidance when retry is unavailable.

Changed files: public/theme.js, public/index.html, public/app.js,
public/styles.css, src/server.mjs, src/attention-queue.mjs,
test/server.test.mjs, test/dashboard.test.mjs and README.md, plus these notes.
Starting unit/API suite: 208/208. New API and browser regressions failed before
implementation. Visual inspection caught named white card backgrounds; the
contrast regression failed before correction. Independent review found two
Important issues (toast contrast and protected-status precedence), no Critical
or Minor issues. Both were reproduced with failing browser regressions and
fixed in one pass. Final unit/API: **209/209**. Full dashboard: **43/43**.
Changed JavaScript syntax and whitespace checks passed. Browser adapter/form
code is unchanged; its prior 3A baseline is historical, not rerun for this fix.

Review boundaries: Phase 3B remains separate (cost: scoped storage limitations
remain until that phase); live LinkedIn entry/submission was not tested (cost:
real employer forms may still need manual completion); production-state
preservation is owned by delivery checks (cost: a missed comparison could hide
state or deployed-code drift). No live application or real applicant answer
was changed by testing. Delivery proof is kept privately under data/verification.
