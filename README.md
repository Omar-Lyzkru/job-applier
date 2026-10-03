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

## Results

- **Submitted:** observed LinkedIn confirmation after Submit.
- **Unconfirmed:** Submit may have been sent, but confirmation was not observed. Check the job on LinkedIn. The app never automatically retries this job.
- **Submission pending:** an attempt has been durably reserved. A restart converts it to Unconfirmed.
- **Needs answer:** a required question or an unknown prefilled value needs explicit information. Save the answer, then run again. Unsupported controls, read-only mismatches, and failed entry remain pending until a successful retry verifies them; saving an answer alone cannot resolve those form problems.
- **Ready — dry run:** review was reached without submitting.
- **Skipped / Failed:** read the recorded reason in History.

Pending and uncertain attempts count toward the daily cap. Defaults are 10 applications per day, at most 100 jobs inspected per run, and 45 seconds between attempts. The counter resets at midnight in your configured timezone, initially America/Chicago. LinkedIn may enforce a separate application/speed limit; the runner pauses when it sees one.

Company-site applications are skipped. Changed layouts, unsupported controls, sign-in checks, and verification challenges pause the run or produce a recorded reason. The initial browser adapter targets English LinkedIn screens. Open LinkedIn to complete sign-in/verification or handle unsupported forms manually.

## Local data

The server listens only on `127.0.0.1`. Profile/settings, answers, pending questions, application history, uploaded résumés, browser cookies, and Chromium binaries are stored under `data/`, excluded from Git. No AI account or API key is needed. Treat `data/` as private; it includes your LinkedIn session.

Only one app process can own a data folder, including when different HTTP ports are used. The Linux kernel releases ownership on exit or crash. Use separate data folders only for deliberately separate profiles/history; the lock applies within this machine's network namespace.

**History → Export CSV** includes the full stored history. The dashboard shows the latest 200 records.

## Verification

```bash
npm test
npm run test:browser
```

The browser suite runs against local fixtures and a test dashboard. It does not contact LinkedIn or submit real applications. It covers multistep forms, explicit answers, uploads, dry runs, confirmation timeouts, draft cleanup, limits, runner caps, duplicate protection, stop races, local API guards, and dashboard controls.

Live job submission requires your account sign-in and profile setup. LinkedIn's DOM and employer forms are variable; fixture verification does not establish support for every live form. Success is recorded only when confirmation is observed.

## Troubleshooting

- **Chromium missing:** run `npm run browser:install`.
- **Browser profile already open:** close the older Job Applier Chromium window, then choose **Open LinkedIn** again. The app reuses its live browser when its LinkedIn tab closes and waits for closure before reopening. Keep the saved browser profile so your sign-in remains available.
- **Missing Linux browser libraries:** use Playwright's documented `npx playwright install-deps chromium` on your machine, then retry. This may need administrator permission.
- **Sign-in expired / verification:** Open LinkedIn, complete it in the browser, then start a new run.
- **Unsupported field / résumé verification failure:** inspect that application in LinkedIn. The app records the reason instead of guessing or claiming success.
- **Port occupied:** use `JOB_APPLIER_PORT=3211 ./start.sh` and the URL printed in the terminal.

See the [design](docs/superpowers/specs/2026-10-01-linkedin-easy-apply-design.md) and [implementation plan](docs/superpowers/plans/2026-10-01-linkedin-easy-apply.md) for the approved scope.
