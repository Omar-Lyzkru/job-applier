# LinkedIn Easy Apply — build specification

Date: October 1, 2026

## Purpose and agreed scope

Build a personal app in `/home/omar/Documents/ChatGPT/Job Applier` that finds LinkedIn Easy Apply jobs and submits applications automatically. The user approved a local app with job filters, résumé/profile setup, saved answers, duplicate checks, a daily cap, Start/Stop controls, and application history.

Success means the user can configure the app, sign in to LinkedIn, start a search, and have supported applications submitted and recorded without completing each form manually. The app must distinguish confirmed submissions from uncertain outcomes.

## Chosen approach

A local Node.js app serves a browser dashboard on `127.0.0.1`. A Playwright worker operates a separate, visible Chromium browser profile for LinkedIn. Configuration, résumés, browser sessions, and history stay on this computer. Playwright is the only required application dependency; the dashboard uses ordinary HTML, CSS, and JavaScript.

An extension would depend on browser installation and an existing tab; a hosted worker would require remote browser sessions. The local approach fits the requested folder and keeps sign-in straightforward.

The first version supports LinkedIn Easy Apply. Jobs that redirect to company sites are skipped. No AI service or API key is required: application answers come from information explicitly entered by the user.

## User flow

1. Launch the app using a documented command or launcher in the project folder.
2. Enter name, email, phone, location, job-search preferences, and a résumé. Add explicit answers for screening questions as needed.
3. Choose **Open LinkedIn** and sign in in the dedicated browser window. Passwords and sign-in codes are entered directly into LinkedIn.
4. Choose **Start applying**. The dashboard shows the active job, progress, pending questions, and recorded results.
5. Choose **Stop** to stop further applications. A submission already clicked is reconciled before the browser closes, where possible.
6. Add answers to pending questions and run again. Confirmed or uncertain submissions are excluded from automatic retries.

## Dashboard and settings

- Dashboard: configuration readiness, browser/runner state, today's count, Start/Stop, Open LinkedIn, current activity, and recent results.
- Search settings: one or more job titles searched separately, location, remote/on-site/hybrid preference, description keywords to include or exclude, daily application cap, and search scan limit. Every include keyword must occur; any exclude keyword rejects the job. Keyword matching is case-insensitive.
- Profile: explicit contact details and one selected PDF, DOC, or DOCX résumé. Reject files over 2 MB and unsupported extensions.
- Answer library: question text, saved response, and pending questions with choices when present. Match normalized question labels and a small, explicit set of contact-field aliases; never fabricate an answer or infer screening answers from a résumé.
- History: company, title, LinkedIn job link, timestamps, status, and a readable reason when skipped or blocked. Include export to CSV.
- Dry run: complete supported steps through review without clicking Submit. Record **Ready — dry run**, separately from real applications.

Initial defaults: 10 applications per day, at most 100 jobs inspected per run, and a 45-second minimum interval between submission attempts. These are adjustable application defaults, not promises about LinkedIn's limits. The local daily counter uses the user's timezone, initially America/Chicago.

## Application worker

Only one browser/runner may use the app profile at a time. A persistent browser context preserves the LinkedIn session across launches. A login, verification, challenge, or platform-limit message pauses the run and presents the reason in the dashboard.

Search using the configured titles and location with the Easy Apply filter. Collect canonical LinkedIn job IDs and links, inspect descriptions for configured filters, and process candidates sequentially. Bound the search and form-step loops so changed pages cannot cause an infinite run.

For each candidate:

1. Check local history and visible already-applied indicators; skip duplicates.
2. Open the job, verify an Easy Apply action, and open its application dialog.
3. Discover visible fields by labels, types, and available choices. Fill only explicit profile or saved-answer matches. Verify existing prefilled values against those matches. Do not trust an unknown prefilled screening response: clear it if optional and safe to clear; otherwise record **Needs answer**. Unknown required responses always need an explicit local answer.
4. Upload and verify the selected local résumé when the application requests one.
5. Advance through supported form steps. If a required field has no explicit answer, record **Needs answer**, capture its label/choices, abandon the draft safely, and move on. Optional unanswered fields may remain blank. Verify that the application dialog has closed before opening another job, including after dry runs; pause the runner if draft cleanup cannot be confirmed.
6. Inspect the review step and validation errors. In dry run, stop before Submit.
7. Persist **Submission pending** before clicking Submit. Click once, then wait for explicit completion evidence.
8. Record **Submitted** only after observed confirmation. If confirmation cannot be established, record **Unconfirmed** and exclude that job from automatic resubmission. Treat recovered **Submission pending** entries the same way after a crash.

Respect the local daily cap and pause immediately if LinkedIn reports an application or speed limit. Count confirmed, unconfirmed, and pending submission attempts toward the cap; dry runs and jobs blocked before Submit do not count. The runner does not bypass sign-in checks or verification challenges.

## Components and local storage

- HTTP server: static dashboard, local configuration/profile APIs, résumé upload, runner control, history export, and status polling.
- Store: validated JSON files with serialized, atomic writes for configuration, answers, and history. Keep operational records durable before submitting.
- Runner: browser ownership, job queue, caps, pacing, stop handling, and status transitions.
- LinkedIn adapter: search/job discovery, form navigation, field discovery, résumé handling, and confirmation detection. Keep page assumptions isolated here.
- Answer resolver: explicit profile aliases, normalized saved-question matching, and type/choice compatibility checks.
- Dashboard: setup, controls, settings, answer management, and history.

Store private files in a git-ignored `data/` directory. Commit source, fixtures, and documentation only. Bind the server to localhost and validate requests so unrelated websites cannot issue runner commands. Render imported job titles and question labels as text.

## Failure behavior

Missing configuration prevents Start and identifies what is needed. Missing Chromium produces a clear installation instruction. An expired session requests sign-in. Unsupported fields, changed layouts, and validation errors produce a recorded reason instead of a false success.

Failed browser actions are bounded and do not blindly retry Submit. On Stop, stop scheduling work immediately and settle any submission already in flight; otherwise record uncertainty. Unexpected server restarts retain history and prevent repeat submissions.

## Verification and delivery

- Node unit tests: answer resolution, required-field handling, search filters, caps, deduplication, atomic persistence, and recovery of uncertain submissions.
- Browser integration tests against local LinkedIn-like fixtures: multi-step forms, text/select/radio/checkbox answers, résumé upload, missing required answers, unknown prefilled responses, draft cleanup failure, dry run, confirmed submission, confirmation timeout, and Stop behavior.
- Dashboard smoke check: profile setup, settings persistence, answer editing, controls, and CSV export.
- No real applications are submitted during development tests. Live validation requires the user's LinkedIn sign-in and completed profile; the first live run can use dry run.

Deliver the runnable source, a launcher, setup/use documentation, and verified test results in the requested folder. Clearly report any checks that could not be run.

## Evidence and practical limits

LinkedIn documents the desktop Easy Apply flow through Review and Submit, along with saved answers and résumé selection. Its forms vary by employer. Public documentation does not provide a stable DOM or confirmation-text contract, so selectors and confirmation recognition need live validation and may require maintenance.

- [LinkedIn application flow](https://www.linkedin.com/help/linkedin/answer/a512388/apply-for-jobs-on-linkedin?lang=en)
- [Saved application information](https://www.linkedin.com/help/linkedin/answer/a507694)
- [Résumé upload guidance](https://www.linkedin.com/help/linkedin/answer/a510363)
- [Easy Apply limits](https://www.linkedin.com/help/linkedin/answer/a8068422)
- [Playwright persistent browser contexts](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)
- [Playwright browser installation](https://playwright.dev/docs/browsers)
- [Playwright locators](https://playwright.dev/docs/locators)

The app can be verified against fixtures before account setup. It cannot guarantee that every LinkedIn employer form is supported, or that an unobserved submission succeeded.
