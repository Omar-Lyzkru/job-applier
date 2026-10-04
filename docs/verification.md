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
