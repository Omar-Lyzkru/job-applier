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
5. Review **Answers** for missing screening questions and save explicit answers. Use the exact question text, or select an offered choice. Your résumé is never used to guess screening answers.
6. Turn off Dry run and choose **Start applying** to submit supported applications automatically.

Profile, answer, and résumé edits take effect in the next run. **Stop** prevents further applications and waits for any submission already in flight to settle.

Country and state / region accept typing and show dropdown suggestions. Enter or choose a country to see its regions; finishing a change to a different country clears the previous region. Saved locations remain visible, recognized abbreviations save as full names, and custom typed values are preserved. LinkedIn and portfolio links accept addresses such as `www.linkedin.com/in/your-name` or `example.com`; saving adds `https://` automatically. Both links are optional.

**Experience level** lets you select Internship, Entry level, Associate, Mid-Senior level, Director, and Executive. Choose several or leave them all clear for any level. For junior searches, start with Entry level; for senior searches, use Mid-Senior level. These use [LinkedIn's experience categories](https://learn.microsoft.com/en-us/linkedin/shared/references/reference-tables/experience-level-codes). The app reads LinkedIn's filter values and confirms your exact selection on each results page. If LinkedIn's filter controls are unavailable or the selection cannot be confirmed, the run stops with instructions to check the filters.

**Keyword matching** controls Include keywords: **Match all keywords** requires every listed term; **Match any keyword** accepts at least one. An empty Include keywords field allows any description. Exclude keywords always skip a job if any listed term appears. Older settings retain Match all keywords until you change it. For example, Match any keyword can accept a Python role even when it does not also mention C++.

The app reads LinkedIn's job description section before checking keywords. It supports the newer **About the job** layout as well as the earlier description layout. If the description cannot be read, the run explains the problem instead of reporting a keyword mismatch. Optional missing job titles or company details keep their search-card values without adding a wait.

**Recommended keywords** reads the uploaded résumé on your computer and suggests recognized skills actually mentioned in its text. Suggestions appear after an upload; choose **Read résumé** to read an existing file. Review the checked suggestions, then choose **Add selected keywords**. This keeps your existing keywords, adds your selection, and chooses **Match any keyword** so a job does not need every skill on your résumé. Edit the list as needed and **Save settings**. Reading a résumé never changes saved filters or supplies screening answers. Suggestions use a built-in skill vocabulary and can miss skills; you can always type additional keywords.

PDF, DOC, and DOCX keyword extraction is included in setup. A scanned PDF needs selectable text; password-protected, damaged, or unusually complex documents may need a fresh PDF or DOCX export. Suggestion failures keep the uploaded résumé available for applications. Résumé text is processed locally and is not sent to an AI service or added to GitHub.

## Results

- **Submitted:** observed LinkedIn confirmation after Submit.
- **Unconfirmed:** Submit may have been sent, but confirmation was not observed. Check the job on LinkedIn. The app never automatically retries this job.
- **Submission pending:** an attempt has been durably reserved. A restart converts it to Unconfirmed.
- **Needs answer:** a required question or an unknown prefilled value needs explicit information. Save the answer, then run again. Unsupported controls, read-only mismatches, and failed entry remain pending until a successful retry verifies them; saving an answer alone cannot resolve those form problems.
- **Ready — dry run:** review was reached without submitting.
- **Skipped / Failed:** read the recorded reason in History.

Pending and uncertain attempts count toward the daily cap. Defaults are 10 applications per day, at most 100 jobs inspected per run, and 45 seconds between attempts. The counter resets at midnight in your configured timezone, initially America/Chicago. LinkedIn may enforce a separate application/speed limit; the runner pauses when it sees one.

Company-site applications are skipped. Changed layouts, unsupported controls, sign-in checks, and verification challenges pause the run or produce a recorded reason. The browser adapter targets English LinkedIn screens. It follows the known **Job search safety reminder** through **Continue applying** and waits for the application fields to load. Unfamiliar warnings and verification checks require your attention. Open LinkedIn to complete sign-in/verification or handle unsupported forms manually.

Résumé uploads support both file fields and LinkedIn's newer **Upload resume** chooser. The app uses a unique filename to verify that the freshly uploaded document was accepted and selected. An older document with the same original filename cannot satisfy that check.

In **Answers**, choice questions such as **Phone country code** let you type to filter the offered choices and view the matching list. Click a choice or use the arrow keys and Enter, then **Save this answer**. Exact typed labels also save; partial names must be selected from the list. The saved answer uses LinkedIn's displayed label rather than its internal option value.

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
