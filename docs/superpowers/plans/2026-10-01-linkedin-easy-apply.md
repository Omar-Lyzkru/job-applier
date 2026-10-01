# LinkedIn Easy Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable local app that finds LinkedIn Easy Apply jobs, fills supported applications using explicit user information, submits them, and records reliable outcomes.

**Architecture:** A localhost Node.js server serves a plain JavaScript dashboard. A single Playwright worker owns a dedicated persistent browser profile; JSON storage persists configuration, answers, questions, and application attempts. Keep browser page assumptions separate from orchestration and storage.

**Tech Stack:** Node.js 24+, ES modules, built-in HTTP/fs/test APIs, Playwright Chromium, HTML/CSS/JavaScript.

**Spec:** `docs/superpowers/specs/2026-10-01-linkedin-easy-apply-design.md`

## Global Constraints

- Target project: `/home/omar/Documents/ChatGPT/Job Applier`; private operational files live in git-ignored `data/`.
- Playwright is the only required application dependency. Bind the server to `127.0.0.1`.
- Defaults: 10 applications per day, 100 jobs inspected per run, a 45-second interval between submission attempts, timezone America/Chicago.
- One runner/browser owner at a time; no external applications or AI-generated screening answers.
- Résumé: PDF, DOC, or DOCX, at most 2 MB; use the explicitly selected local file.
- Every include keyword must match the description; any exclude keyword rejects it; matching ignores case.
- Pending/unconfirmed attempts consume the daily cap and are never automatically retried. Dry runs never consume it.
- No live job submissions during development verification. English LinkedIn UI is the initial adapter target; unsupported layouts pause or produce a recorded failure.

## Review Focus

- A process restart after Submit must not cause a duplicate application; Task 1 tests pending-attempt recovery.
- Unknown LinkedIn-prefilled screening responses must not be submitted; Task 2 tests clearing/blocking them.
- Stop during a submission must preserve an uncertain outcome and prevent the next job; Task 3 tests this race.
- A malicious page must not start the local runner or inject markup through imported job data; Tasks 4 and 5 test request guards and text rendering.
- Résumé replacement or settings edits during a run must not change its snapshot; Tasks 3 and 4 test snapshot isolation and immutable upload paths.

---

## File map and shared contracts

Create `src/domain.mjs` (defaults, validation, matching and answer resolution), `src/store.mjs` (atomic persistence), `src/browser/session.mjs` (browser ownership), `src/browser/forms.mjs` (field discovery/filling), `src/browser/linkedin.mjs` (LinkedIn flow), `src/runner.mjs` (orchestration), `src/server.mjs` (HTTP API), `public/index.html`, `public/app.js`, `public/styles.css`, `scripts/install-browser.mjs`, `scripts/test-browser.mjs`, `start.sh`, `setup.sh`, `README.md`, and tests under `test/`.

Use these shapes consistently:

- `Config`: `{ profile: {firstName,lastName,email,phone,city,state,postalCode,country,linkedinUrl,website}, search: {titles,location,workplace,includeKeywords,excludeKeywords}, dailyCap,scanLimit,intervalSeconds,timezone,resume,dryRun }`. `resume` is null or `{path,filename,size}`. `workplace` is `any|remote|hybrid|onsite`.
- `Job`: `{id,url,title,company,description?}`; `id` is LinkedIn's canonical job ID.
- `Field`: `{key,label,type,required,options,value}`. `options` is an array of `{label,value}`; browser element handles stay private to the adapter.
- `Record`: `{id,job,status,reason,startedAt,attemptedAt,finishedAt,evidence?}`; status is `skipped|needs_answer|ready|submission_pending|submitted|unconfirmed|failed`.
- `PendingQuestion`: `{key,label,type,options,jobId}`. `Answers` maps normalized question keys to explicit string, number, or boolean values.
- `ApplyResult`: `{status,reason,pendingQuestions?,evidence?}`; adds `paused` for a platform/session/cleanup interruption.
- Runner status: `{state,currentJob,message,startedAt,finishedAt,todayCount}`, with state `idle|running|stopping|paused|failed`.

### Task 1: Durable data and explicit answer resolution

**Files:** Create `package.json`, `.gitignore`, `src/domain.mjs`, `src/store.mjs`; test `test/domain.test.mjs`, `test/store.test.mjs`.

**Interfaces:**
- `defaultConfig() -> Config`, `validateConfig(input) -> Config`, `readiness(config) -> string[]`, `normalizeQuestion(text) -> string`.
- `resolveAnswer(field, profile, answers) -> {kind:'fill',value,source}|{kind:'missing',reason}`; match complete normalized labels or exact contact aliases, and reject incompatible choices.
- `matchesJob(description, search) -> boolean`, `dayKey(date,timezone) -> string`, `countsTowardCap(record,day,timezone) -> boolean`, `blocksRetry(record) -> boolean`.
- `await createStore(dataDir) -> Store`: async `getConfig()`, `saveConfig(config)`, `getAnswers()`, `saveAnswers(answers)`, `getQuestions()`, `saveQuestions(questions)`, `getHistory()`, `createRecord(job,status) -> Record`, `updateRecord(id,patch) -> Record`, `recoverPending() -> void`.

- [ ] Write tests for exact answer aliases, choice incompatibility, `false`/`0` answers, unknown required fields, include-all/exclude-any matching, timezone day boundaries, and the pinned defaults.

```js
assert.equal(defaultConfig().dailyCap, 10);
assert.equal(defaultConfig().scanLimit, 100);
assert.equal(defaultConfig().intervalSeconds, 45);
assert.equal(resolveAnswer({label:'Years of Java experience',type:'number',options:[]}, {}, {}).kind, 'missing');
```

- [ ] Write store tests for durable updates, serialized concurrent writes, readable errors for corrupt files, and restart recovery: `submission_pending` becomes `unconfirmed` and continues to block retry/count toward the cap.
- [ ] Run `node --test test/domain.test.mjs test/store.test.mjs`; verify failures identify missing production modules/behavior.
- [ ] Implement these interfaces, schema/type validation, separate readiness checks permitting incomplete saved setup, explicit aliases, and atomic write/rename operations. Git-ignore all `data/`, dependencies, and test artifacts.
- [ ] Run the same tests; require all pass. Commit the task.

### Task 2: Browser session and the Easy Apply adapter

**Files:** Create `src/browser/session.mjs`, `src/browser/forms.mjs`, `src/browser/linkedin.mjs`, `scripts/install-browser.mjs`, `scripts/test-browser.mjs`, `test/adapter.test.mjs`, and `test/fixtures/`.

**Consumes:** Task 1's `Config`, `Job`, `Field`, `resolveAnswer()` and `ApplyResult`.

**Produces:** `createLinkedInAdapter({dataDir,headless=false,fixtureBaseUrl=null,timeouts={}}) -> Adapter`, with async `openBrowser()`, `isSignedIn()`, `inspect(job) -> {description,alreadyApplied,easyApply}`, `apply(job,{profile,answers,resumePath,dryRun,signal,beforeSubmit}) -> ApplyResult`, `close()`; `findJobs(search,{scanLimit,signal})` returns an async iterable of `Job`. `beforeSubmit()` must resolve before the single Submit click; rejection prevents that click.

- [ ] Create local fixtures modeling search cards, job details, multistep application dialogs, text/number/select/radio/checkbox controls, résumé uploads, review, success, limits, sign-in interruption, and stuck cleanup. Fixture configuration controls outcome without contacting LinkedIn.
- [ ] Write browser tests showing correct contact/choice answers and selected résumé, unknown required answers blocked, unknown optional prefilled values cleared, review dry run with zero Submit clicks, confirmed success, and confirmation timeout returning `unconfirmed`.
- [ ] Add tests proving `beforeSubmit` occurs before exactly one click, its rejection prevents submission, external Apply is skipped, and failed dialog cleanup returns `paused` before another application can open.
- [ ] Test paginated candidate discovery for canonical job IDs and the scan bound, workplace/location search settings, single persistent-browser ownership, and an expired sign-in session.

```js
// adapter: submission_guard_precedes_one_click; unknown_required_answer_blocks;
// prefilled_unknown_optional_is_cleared; confirmation_timeout_is_uncertain.
assert.deepEqual(fixture.events, ['guard', 'submit']);
assert.equal(fixture.submitClicks, 1);
assert.equal(blocked.status, 'needs_answer');
assert.equal(timedOut.status, 'unconfirmed');
```
- [ ] Add Playwright and scripts using `data/browsers` as the browser cache. Install matching Chromium locally and run `npm run test:browser`; verify expected missing-adapter failures before implementation.
- [ ] Implement separate persistent browser ownership and dialog-scoped role/label selectors. Isolate search URL/card assumptions. Bound discovery, navigation, and form-step loops. Verify résumé selection; do not accept an arbitrary preselected résumé. Detect login/challenge/limits and return a clear interruption. Mark success only after observed completion evidence.
- [ ] Run `npm run test:browser`; require every fixture scenario to pass. Commit the task.

### Task 3: Single-runner orchestration and durable submission guards

**Files:** Create `src/runner.mjs`; test `test/runner.test.mjs`.

**Consumes:** Store from Task 1 and Adapter from Task 2. Inject `clock.now()` and `clock.sleep(ms,signal)` for deterministic pacing tests.

**Produces:** `createRunner({store,adapter,clock}) -> Runner`: async `start({dryRun}={})`, `stop()`, `openBrowser()`, `waitForIdle()`; synchronous `getStatus()`. `start()` validates readiness, snapshots config/answers/résumé, launches a background run, and rejects a second active start.

- [ ] Write tests with a fake Adapter for filter rejection, scan bound, duplicates, confirmed/unconfirmed cap accounting, zero-cap-impact dry runs, missing configuration, second-start rejection, and platform-limit pauses.
- [ ] Test the pre-submit race: stop before the callback prevents a click; stop after a pending record exists preserves a submitted/unconfirmed result and never visits another job. Changing config, answers, or the selected résumé during the run must not alter its snapshot.
- [ ] Test an adapter exception after the pre-submit guard: preserve `unconfirmed`, count the attempt, and block automatic retry rather than rewriting it as a retryable failure.

```js
// runner: cap_includes_uncertain_attempt; double_start_rejected;
// stop_during_submission_preserves_uncertainty; run_uses_configuration_snapshot.
assert.equal(adapter.submitCalls, 1); // cap=1, even after uncertain outcome
assert.equal(history.at(-1).status, 'unconfirmed');
assert.equal(adapter.visitedJobs.length, 1); // stopped during first submission
assert.equal(adapter.usedResume, originalResume.path);
```
- [ ] Run `node --test test/runner.test.mjs`; verify failures from the missing implementation.
- [ ] Implement sequential job processing, durable record transitions, pacing immediately before attempts, and a final cap/stop check in `beforeSubmit`. Recover pending records at startup. Save pending questions and verify draft cleanup through the adapter. Close browser ownership when the run stops/finishes without deleting its session.
- [ ] Run `node --test test/domain.test.mjs test/store.test.mjs test/runner.test.mjs`; require all pass. Commit the task.

### Task 4: Local HTTP API and private uploads

**Files:** Create `src/server.mjs`; test `test/server.test.mjs`.

**Consumes:** Store and Runner. **Produces:** `await createApp({dataDir,store,runner,port=3210}) -> {listen(),close(),url}`; executable server startup creates the real store/adapter/runner.

API routes: `GET /api/bootstrap` returns config/answers/questions/history/status and a random per-process command token; `GET /api/status`; `POST /api/config`; `POST /api/answers`; `POST /api/resume` accepts binary file contents and an encoded filename header; `POST /api/run` accepts `{dryRun}`; `POST /api/stop`; `POST /api/browser`; `GET /api/history.csv`. Serve the dashboard as same-origin static files.

- [ ] Write tests using a temporary data directory and fake Runner: save/read setup, answer normalization, start/stop/browser dispatch, CSV quoting, request errors, and bootstrap output.
- [ ] Test local Host and Origin checks plus required command-token validation on writes. Reject remote origins, unknown routes, traversal attempts, oversized bodies, and unsupported résumé extensions. Uploaded files use unique generated paths, so replacement cannot mutate an in-flight run's selected file.

```js
// server: rejects_cross_origin_command; rejects_oversized_resume;
// replacement_keeps_previous_resume_file; quotes_csv_cells.
assert.equal(crossOrigin.status, 403);
assert.equal(oversizedResume.status, 413); // > 2_000_000 bytes
assert.notEqual(firstUpload.path, secondUpload.path);
assert.equal(await readFile(firstUpload.path, 'utf8'), firstContents);
```
- [ ] Run `node --test test/server.test.mjs`; verify expected failures before implementation.
- [ ] Implement the API using built-in HTTP/fs modules, bounded body reads, structured error responses, safe static resolution, immutable uploads, and localhost-only binding. Avoid logging profile contents or cookies. Settings changes affect the next run.
- [ ] Run `npm test`; require all domain/store/runner/server unit tests to pass. Commit the task.

### Task 5: Dashboard, launchers, and end-to-end delivery

**Files:** Create `public/index.html`, `public/app.js`, `public/styles.css`, `start.sh`, `setup.sh`, `README.md`; test `test/dashboard.test.mjs`.

**Consumes:** Task 4's API. **Produces:** A usable dashboard plus `./setup.sh`, `./start.sh`, `npm start`, `npm test`, `npm run test:browser` and a documented dry-run-first workflow.

- [ ] Write a browser smoke test against the real local server with a fake Runner: save profile/search settings, upload a résumé, add an answer, open the browser, start/stop, display current progress and pending questions, and export history. An imported `<img onerror=...>` job title must appear as literal text.

```js
// dashboard: setup_controls_and_history_work; external_job_text_is_not_markup.
assert.equal(savedConfig.search.titles[0], 'Software Engineer');
assert.equal(fakeRunner.startCalls, 1);
assert.equal(await page.locator('.job-title img').count(), 0);
assert.equal(await page.locator('.job-title').first().textContent(), hostileTitle);
```
- [ ] Run the dashboard test through `npm run test:browser`; verify failures from absent UI elements/behavior.
- [ ] Build a responsive, accessible dashboard with Dashboard/Settings/Answers/History views, labeled inputs, readable status/reasons, busy-state controls, explicit dry-run labeling, and polling. Render external strings using text content. Show that edits affect the next run.
- [ ] Add launchers that locate their own directory, verify Node 24+, install the pinned dependency/browser during setup, and launch the local dashboard. Document login, profile setup, normal and dry runs, saved questions, Stop, data location, tests, and current live-validation limitations.
- [ ] Run `npm test` and `npm run test:browser` once the final changes are in place. Inspect the dashboard in a browser at desktop and narrow widths. Confirm no fixture results are presented as real submissions.
- [ ] Obtain a fresh whole-change review, fix material findings, and rerun only checks affected by fixes. Commit the finished task.
- [ ] Place the finished source in the requested Job Applier folder, preserve its design/plan history, and report commands, verification evidence, and the required LinkedIn sign-in/profile setup. Do not claim live submission verification without observing it.

## Execution recommendation

Use **Native** execution: these five tasks share a small set of precise interfaces, so one implementer can keep them consistent while a fresh reviewer checks the complete result. The plan still requires tests before implementation and independent review before delivery. Subagent-driven execution is available if the user prefers a reviewer after each task.
