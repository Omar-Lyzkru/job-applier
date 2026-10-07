# Job Applier

A local LinkedIn Easy Apply app. It searches your target roles, fills supported forms with your profile and saved answers, submits applications, and keeps a local history.

## Start

This build runs on Linux with Node.js 24 or newer. On a fresh copy, install the dependency and Chromium once:

```bash
./setup.sh
```

Then launch the app:

```bash
./start.sh
```

Open [the dashboard](http://127.0.0.1:3210). Keep the terminal running while you use the app; Ctrl+C stops the server and browser. Use `JOB_APPLIER_PORT=3211 ./start.sh` if the default port is occupied.

## First run

1. In **Settings**, enter your contact details, job titles (one per line), search location, workplace preference, and optional description keywords. Save settings.
2. Upload the résumé you want employers to receive: PDF, DOC, or DOCX, up to 2 MB. Each local upload keeps its original filename in a separate folder. The LinkedIn upload adds a unique suffix to the filename, allowing the app to verify that the new document was accepted and selected even when a previous résumé had the same name.
3. In **Dashboard**, choose **Open LinkedIn**. Sign in directly in that browser window; the app preserves this separate browser session.
4. Turn on **Dry run (no submissions)** for a first check, then choose **Start dry run**. Supported forms stop at review. Results say **Ready — dry run**.
5. In **Answers**, open **Common questions** to save recurring education and screening answers before a run. Review any missing questions and select an offered choice where available. Your résumé is never used to guess screening answers.
6. Turn off Dry run and choose **Start applying** to submit supported applications automatically.

Use **Dark mode** / **Light mode** in the sidebar to switch appearance. Your choice stays in this browser; it does not change your profile or application settings.

Profile, answer, and résumé edits take effect in the next run. **Stop** prevents further applications and waits for any submission already in flight to settle.

Country and state / region accept typing and show dropdown suggestions. Enter or choose a country to see its regions; finishing a change to a different country clears the previous region. Saved locations remain visible, recognized abbreviations save as full names, and custom typed values are preserved. LinkedIn and portfolio links accept addresses such as `www.linkedin.com/in/your-name` or `example.com`; saving adds `https://` automatically. Both links are optional.

**Experience level** lets you select Internship, Entry level, Associate, Mid-Senior level, Director, and Executive. Choose several or leave them all clear for any level. For junior searches, start with Entry level; for senior searches, use Mid-Senior level. These use [LinkedIn's experience categories](https://learn.microsoft.com/en-us/linkedin/shared/references/reference-tables/experience-level-codes). The app reads LinkedIn's filter values and confirms your exact selection on each results page. If LinkedIn's filter controls are unavailable or the selection cannot be confirmed, the run stops with instructions to check the filters.

**Keyword matching** controls Include keywords: **Match all keywords** requires every listed term; **Match any keyword** accepts at least one. An empty Include keywords field allows any description. Exclude keywords always skip a job if any listed term appears. Older settings retain Match all keywords until you change it. For example, Match any keyword can accept a Python role even when it does not also mention C++.

The app reads LinkedIn's job description section before checking keywords. It supports the newer **About the job** layout as well as the earlier description layout. If the description cannot be read, the run explains the problem instead of reporting a keyword mismatch. Optional missing job titles or company details keep their search-card values without adding a wait.

**Recommended keywords** reads the uploaded résumé on your computer and suggests recognized skills actually mentioned in its text. Suggestions appear after an upload; choose **Read résumé** to read an existing file. Review the checked suggestions, then choose **Add selected keywords**. This keeps your existing keywords, adds your selection, and chooses **Match any keyword** so a job does not need every skill on your résumé. Edit the list as needed and **Save settings**. Reading a résumé never changes saved filters or supplies screening answers. Suggestions use a built-in skill vocabulary and can miss skills; you can always type additional keywords.

PDF, DOC, and DOCX keyword extraction is included in setup. A scanned PDF needs selectable text; password-protected, damaged, or unusually complex documents may need a fresh PDF or DOCX export. Suggestion failures keep the uploaded résumé available for applications. Résumé text is processed locally and is not sent to an AI service or added to GitHub.

## Intelligent matching (optional)

In **Settings → Intelligent matching**, turn on **Enable intelligent matching**
to collect a bounded scan and apply to the highest-scoring suitable jobs first.
Existing searches keep their streaming keyword behavior until you enable it.

Confirm your skills, professional years, current student status, and current or
completed education only when you know them. Unknown facts remain unknown;
reviewing an empty skills or clearances list explicitly means none. You can read
your résumé and choose **Add selected skills**, then **Save settings** to confirm
those choices. **Add selected keywords** still edits search preferences separately.
Neither action creates screening or legal answers.

Choose role families and edit their titles, keep your own Job titles, and add
search regions with priorities from 0 to 10. For remote searches, use an actual
geographic location (for example United States) and choose Remote as its workplace.
Up to 50 title/region queries are supported. Queries share the scan limit fairly;
the scan limit may be too small to cover every query.

The default minimum fit score is 70. The rubric weights role (20), technical
skills (25), experience (15), education/student status (10), location (10), posting
age (10), Easy Apply (5), and interests (5). Unknown factors receive half their
points, but unknown required eligibility still requires review. Required skills
count three times as much as preferred skills. Lowering the minimum below 70
allows Borderline jobs; scores below 55 remain skipped. This score is a ranking
rubric, not a hiring probability. Include keywords become interests in this mode;
excluded terms and companies remain hard rules.

Results show **Fit** and **Why this fit**, including points, skill gaps and
uncertainties. Recognized unpaid, commission-only or incompatible required roles
can be excluded before scoring. Strong reposts need matching company, equivalent
title, known location and description; prior submitted or uncertain attempts
block another attempt. Unattempted failures can be retried explicitly. A known local failure, such as
an unreadable posting, is recorded and other jobs continue when safe. Unknown
failures, sign-in challenges, storage problems, and failed cleanup pause the run.

English parsing and synthetic browser tests cannot cover every employer wording
or LinkedIn layout. Unknown eligibility and weaker duplicate similarity need
review. Form convergence and recovery are described below; live layouts may
still require manual completion.

## Needs attention and explicit resume

The Dashboard lists blocked and interrupted applications with their job link,
phase, last update, blocker and retry eligibility. Counts include the full local
history, even when an item falls outside the latest 200 History rows. Answers
and History link back to this list.

Save required answers in **Answers**, then choose **Retry application** to
reinspect just that job. **Resume ready applications** retries up to 100 jobs
whose missing answers are resolved, plus safely interrupted work. Operational
or unknown legacy failures require an individual retry; unsupported controls
and uncertain attempts have no retry button. Saving an answer and dashboard
polling never start applications.

Retries use the visible **Dry run (no submissions)** choice and current saved
settings, résumé and answers. Each run keeps one snapshot of those inputs.
Changed preferences can cause an old job to be skipped. Targeted resume opens
original job URLs without a new search; it refills a fresh form rather than
restoring stale controls. Linked retry records preserve the earlier failure.

The app saves work before inspecting/filling and reserves an attempt before
Submit. On restart, unfinished pre-submit work becomes **Interrupted** and a
reserved submission becomes **Unconfirmed**. It never resumes automatically.
Attempted and equivalent submitted/uncertain jobs remain protected against
another submission, including during concurrent commands or pacing waits.

Form entry rediscovers controls after changes, verifies the selected answer,
and checks newly appearing questions. Navigation and entry retries are bounded;
only recognized temporary network failures get up to two navigation retries.
The form is checked again after pacing and immediately before reserving Submit.
Stop interrupts bounded waits and records any submission already in flight.
The app does not retry Submit automatically.

**View diagnostics** shows a local sanitized failure snapshot when available.
Snapshots contain fixed failure codes, phase/page index, control counts,
hashed control fingerprints, validation categories and action timings.
They omit form values, employer text, raw errors, résumé filenames, HTML,
cookies and screenshots. Files stay under ignored `data/failures/` with private
permissions and a limit of 100 owned snapshots. Snapshot failure does not change
application truth; missing snapshots show an unavailable message. Diagnostic
access requires the app token and a known history record.

English-only controls and synthetic checks cannot guarantee every live employer
form, late form change or LinkedIn layout. Complete unsupported controls or
verification directly in LinkedIn; uncertain submissions need a manual check.

## Results

- **Submitted:** observed LinkedIn confirmation after Submit.
- **Unconfirmed:** Submit may have been sent, but confirmation was not observed. Check the job on LinkedIn. The app never automatically retries this job.
- **Submission pending:** an attempt has been durably reserved. A restart converts it to Unconfirmed.
- **Needs answer:** a required question or an unknown prefilled value needs explicit information. Save the answer, then explicitly retry the application from Needs attention. Unsupported controls, read-only mismatches, and failed entry remain pending until a successful retry verifies them; saving an answer alone cannot resolve those form problems.
- **Needs attention:** a form or operational blocker requires inspection or manual completion.
- **Interrupted:** queued or unfinished pre-submit work was preserved after Stop or restart.
- **Queued / Inspecting / Filling:** durable work currently in progress.
- **Ready — dry run:** review was reached without submitting.
- **Skipped / Failed:** read the recorded reason in History.

Pending and uncertain attempts count toward the daily cap. Defaults are 10 applications per day, at most 100 jobs inspected per run, and 45 seconds between attempts. The counter resets at midnight in your configured timezone, initially America/Chicago. LinkedIn may enforce a separate application/speed limit; the runner pauses when it sees one.

Company-site applications require manual completion and have no automatic retry. Changed layouts and unsupported controls produce a recorded attention item; the run can continue after confirmed cleanup. Sign-in checks, unfamiliar verification warnings, platform limits, storage failures, and cleanup failures pause the run. The browser adapter targets English LinkedIn screens. It follows the known **Job search safety reminder** through **Continue applying** and waits for the application fields to load. Unfamiliar warnings and verification checks require your attention. Open LinkedIn to complete sign-in/verification or handle unsupported forms manually.

Résumé uploads support both file fields and LinkedIn's newer **Upload resume** chooser. The app uses a unique filename to verify that the freshly uploaded document was accepted and selected. An older document with the same original filename cannot satisfy that check.

In **Answers**, choice questions such as **Phone country code** let you type to filter the offered choices and view the matching list. Click a choice or use the arrow keys and Enter, then **Save this answer**. Exact typed labels also save; partial names must be selected from the list. The saved answer uses LinkedIn's displayed label rather than its internal option value.

Compatible pending repeats share one editor. The count shows distinct questions
and affected applications; expand **Affected applications** to see every original
label, employer, job link, and failure reason. Different choices, controls, date
formats, employer consent, or conflicting saved provenance keep separate cards.
Saving writes the existing answer key once and preserves operational blockers.

**Questions to answer** counts only unresolved answer information. The Answers screen separates **Needs an answer**, **Answer saved — retry needed**, and **Manual completion needed**. Saving an answer moves a resolved entry failure out of the unanswered count; it still needs an explicit retry or manual completion to verify the LinkedIn form. History keeps the original outcome.

Pending questions show the saved answer after saving or reloading. If LinkedIn
could not enter it, the card keeps its failure reason and explains that entry
needs a retry; this does not mean the answer was lost. Unsaved edits survive
polling, membership changes, other answer saves, and rejected saves. If a group
splits, choose **Use for this question** to place a retained edit explicitly. If
choices or formats change, the old edit remains separately visible. Unsaved
edits remain in the current page session; press Save before closing or reloading.

**Common questions** includes current student status, school, degree, major,
graduation, position, location, department, address, US work authorization, and
US visa sponsorship. The app reuses your explicitly saved answers for finite
recognized wording and shows their source. It recognizes years of Java,
JavaScript, TypeScript, Python, Rust, React, Node.js, SQL, PostgreSQL, and Git
experience, preserving the distinction between total and professional years.
Matching-profile facts and résumé skills never fill these screening answers.

The app also recognizes explicitly named overall total/professional experience
and selected equivalent current/completed-degree and student questions. US
sponsorship needed **now**, **in the future**, and **now or in the future** are
three distinct meanings: one answer never supplies another period. Only your
explicit answer to that same meaning can be reused.

Pending and common question cards explain the meaning and whether a saved answer
matches. Expand **Why this answer** for its source and any format/entry issue.
A legal question can reuse a compatible confirmed No without asking again;
changed choices, unknown wording, conflicting values and unsupported controls
still need review. Salary, relocation and non-SMS consent have no new automatic
aliases. These explanations do not change saved answers or launch applications.

Current study and completed education, work authorization and sponsorship, and
each employer's consent remain separate. Old C/C++/C# experience keys can
collide, so those questions require manual confirmation in LinkedIn.

Conflicting answers, uncertain wording, unavailable choices, and incompatible
graduation date formats need review. Generic similar wording only suggests
ordinary answers; legal, consent, salary, certification, clearance, and identity
questions are excluded in both directions. A suggested answer is saved only
after you choose it and press Save.

**Text message consent** is saved separately for each employer. Choose an employer and explicitly answer Yes or No; neither is selected for you. Consent for application updates does not answer a differently worded marketing, calling, or negative consent question. Unknown employers require completion directly in LinkedIn.

The completed-run message reports jobs checked, submission attempts, confirmed submissions, jobs needing answers, and skips. Finding a job does not count as applying: an attempt begins when the app reserves its submission, and **Submitted** requires LinkedIn confirmation. If every checked job is skipped and keyword filters rejected jobs, the message points you to review those filters.

## Local data

The server listens only on `127.0.0.1`. Profile/settings, answers, pending questions, application history, uploaded résumés, browser cookies, and Chromium binaries are stored under `data/`, excluded from Git. No AI account or API key is needed. Treat `data/` as private; it includes your LinkedIn session.

Only one app process can own a data folder, including when different HTTP ports are used. The Linux kernel releases ownership on exit or crash. Use separate data folders only for deliberately separate profiles/history; the lock applies within this machine's network namespace.

**History → Export CSV** includes the full stored history. The dashboard shows the latest 200 records.

## Verification

```bash
npm test
npm run test:browser
```

The browser suite runs against local fixtures and a test dashboard. It does not contact LinkedIn or submit real applications. It covers multistep forms, explicit answers, uploads, résumé keyword selection, dry runs, confirmation timeouts, draft cleanup, limits, runner caps, duplicate protection, stop races, local API guards, and dashboard controls. The local API tests read synthetic PDF, DOC, and DOCX résumés and verify that recommendations leave saved settings unchanged.

Live job submission requires your account sign-in and profile setup. LinkedIn's DOM and employer forms are variable; fixture verification does not establish support for every live form. Success is recorded only when confirmation is observed.

## Troubleshooting

- **Chromium missing:** run `npm run browser:install`.
- **Browser profile already open:** close the older Job Applier Chromium window, then choose **Open LinkedIn** again. The app reuses its live browser when its LinkedIn tab closes and waits for closure before reopening. Keep the saved browser profile so your sign-in remains available.
- **Missing Linux browser libraries:** use Playwright's documented `npx playwright install-deps chromium` on your machine, then retry. This may need administrator permission.
- **Sign-in expired / verification:** Open LinkedIn, complete it in the browser, then start a new run.
- **Experience filter unavailable / unconfirmed:** check LinkedIn's search filters in its browser, or clear the Experience level choices in Settings and save before retrying. The app does not accept results when a selected experience filter cannot be confirmed.
- **Unsupported field / résumé verification failure:** inspect that application in LinkedIn. The app records the reason instead of guessing or claiming success.
- **Port occupied:** use `JOB_APPLIER_PORT=3211 ./start.sh` and the URL printed in the terminal.

See the [design](docs/superpowers/specs/2026-10-01-linkedin-easy-apply-design.md) and [implementation plan](docs/superpowers/plans/2026-10-01-linkedin-easy-apply.md) for the approved scope.
