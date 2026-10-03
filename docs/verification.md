# Verification and review

Verified on this Linux desktop with Node 24.21.0 and Playwright 1.62.1.

- `npm test`: 37/37 unit, runner, storage, and localhost API tests pass.
- `npm run test:browser`: 34/34 local Chromium fixture/dashboard scenarios pass.
- Visible Chromium launch and fixture sign-in detection pass.
- Shell/JavaScript syntax and Git whitespace checks pass.
- Desktop and mobile screenshots inspected by the author; no mobile document overflow.

The initial whole-change reviewer found six material issues. One regression-driven fix pass addressed exclusive data ownership, accepted/selected résumé uploads, custom ARIA control discovery, semantic choice matching, persistent operational blockers, and CV screening questions. Each regression failed before its fix. The reviewer reported no minor findings.

Tests never contact LinkedIn or submit real applications. Live LinkedIn compatibility remains unverified until the user's profile and account are configured. Unsupported employer controls require manual completion. This build uses Linux abstract sockets for exclusive data-folder ownership within one network namespace; no stale lock-file cleanup is needed.

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
