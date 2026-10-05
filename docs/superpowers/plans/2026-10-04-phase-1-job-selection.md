# Phase 1 Job Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Discover a bounded, diverse job set and apply to its best explicit-fit candidates first.

**Architecture:** Pure skill/parsing modules produce evidenced normalized facts. Validated opt-in preferences drive hard decisions, the specified score, search queries, and strong fingerprints. The adapter supplies raw posting facts; the runner integrates ranking without replacing its durable submission guard.

**Tech Stack:** Existing Node.js ESM, node:test, Playwright, atomic JSON store, and browser dashboard; no new dependencies.

**Spec:** ../specs/2026-10-04-phase-1-intelligence-design.md

## Global Constraints

- Read and obey 2026-10-04-phase-1-intelligence.md, including its preflight and final integration gate.
- Intelligent matching is opt-in. Missing facts remain unknown.
- The minimum application score is an integer from 55–100, initially 70.
- No screening answer is inferred from the résumé or matching profile.
- Existing submission behavior remains controlled by the current dry-run switch, caps, pacing, and durable guard.
- Use synthetic fixture data only. No live applications or changes to real stored answers during verification.

## Review Focus

- Negated/preferred requirements and colleagues' experience are not mandatory applicant qualifications: Task 1/2 tests.
- Null facts and empty confirmed lists must differ; old include terms cannot confirm a skill: Task 2/5 tests.
- Unreadable descriptions must stop before queued applications: Task 4 tests.
- Small budgets, duplicate IDs, buffered cards, and cancellation must stay bounded: Task 3 tests.
- Different reposts and unattempted failures must not be permanently suppressed: Task 4 tests.

## File map and shared contracts

Create src/skills.mjs for explicit skill vocabulary and boundaries; src/job-parser.mjs
for evidenced posting interpretation; src/intelligence-config.mjs for matching
settings; src/search-profiles.mjs for presets/query generation; src/job-intelligence.mjs
for eligibility and score calculation; and src/job-duplicates.mjs for strong
fingerprints/retry checks. Follow existing small ESM exports rather than adding
a framework. Keep browser form parsing outside these modules.

NormalizedJob retains id/url/title/company/description plus normalizedTitle,
normalizedCompany, descriptionHash, familyId, experienceLevel, employmentType,
location, skills, requirements, compensation, application, postedAt, and evidence.
Unknown scalar facts are null; requirements is an array of evidenced clauses.
Skills is an object with required/preferred/optional/unclassified canonical ID
arrays, with each skill's source clauses retained in evidence. Location
has raw text, canonical key, city/state/country when recognized, workplace,
remote, and evidence; unknown fields are null. Application type is easy_apply,
external, or null. Requirements are {kind, required, value, scope, evidence};
scope distinguishes pursuing/completed education and existing/obtainable
clearance. The parser never claims all unrecognized requirements were understood.

IntelligenceConfig has enabled=false, minimumFitScore=70, candidate,
roleFamilies=[], familyTitles={}, regions=[], preferredCompanies=[],
excludedCompanies=[], preferredFamilies=[], excludeUnpaid=true,
excludeCommissionOnly=true, and rejectSeniorForEntry=true. Candidate has
skills=null, professionalYears=null, student=null, currentEducation=null,
completedEducation=null, clearances=null. Education is {degree,major}; degree
uses none/high_school/associate/bachelor/master/doctorate. A selected completed
degree is an explicit relevant qualification, not proof of every lower degree.
Student is boolean/null, years is a finite 0–80 number/null, and skills/clearances
are string arrays/null. Preserve zero, false, null, and confirmed empty arrays.

Region entries are {name,priority,workplace}, with a nonempty actual search
location, integer priority 0–10, and any/remote/hybrid/onsite workplace. A remote
region searches its actual geographic name with remote workplace; do not send
the literal word Remote as a geographic location. Cap regions at 10, known
family IDs at 8, and strings/lists with the existing list limits. Validate the
expanded query maximum of 50 when matching is enabled; allow incomplete setup
to be saved and report missing query inputs through readiness.

Assessment is {decision,score,band,factors,reasons,matchedSkills,missingSkills,
uncertainties}; decision is apply/review/skip, score is integer/null, and each
factor is {key,earned,max,evidence,unknown}. Reasons are {code,message,evidence}.
Decisions are selection policy, not a claim that the employer will consider
the applicant qualified. Technical skill gaps affect the specified rubric;
strict years/education/student/clearance conflicts remain hard decisions.

### Task 1: Normalize evidenced job facts and skill identities

**Files:** Create src/skills.mjs, src/job-parser.mjs, test/job-intelligence.test.mjs. Modify src/resume-keywords.mjs and package.json's enumerated test command. Preserve test/resume-keywords.test.mjs behavior.

**Interfaces:**
- Produce canonicalSkill(text) -> canonical ID/null, skillLabel(id) -> display text, and extractSkills(text,{context}) -> canonical IDs in src/skills.mjs. Context is resume or qualification; only explicit aliases, no semantic inference.
- Produce normalizeJob(candidate,details,{now}) -> NormalizedJob in src/job-parser.mjs. Details contains description, easyApply, alreadyApplied, optional raw location/workplace/postedAt/postedAge, and evidence. now is a supplied Date.
- Re-export/reuse the existing vocabulary so recommendKeywords(text) retains current return labels, ordering, and prose/contact guards.

- [x] Write named tests for punctuation-aware aliases and boundaries, section classification, required-over-preferred deduplication, experience negation, required versus pursuing/completed education, paid/base-plus-commission wording, and stable SHA256 description hashes. Include assertions:

```js
assert.equal(canonicalSkill('CPP'), 'c++');
assert.equal(canonicalSkill('C#'), 'c#');
assert.equal(canonicalSkill('JS'), 'javascript');
assert.notEqual(canonicalSkill('Java'), canonicalSkill('JavaScript'));
assert.notEqual(canonicalSkill('C'), canonicalSkill('C++'));
assert.deepEqual(extractSkills('Required: JS, Postgres and CPP', {context:'qualification'}), ['javascript','postgresql','c++']);
```

Use synthetic descriptions: Required: Python and Git / Preferred: AWS and SQL;
No professional experience required; Mentored by engineers with 8 years of
experience; Master's preferred; Currently pursuing a bachelor's degree in
Computer Science; Paid internship with base salary plus commission; Pay: $25–$30
per hour; Salary: $60,000–$75,000 per year. Assert hourly/annual range amounts,
units, employment type only when explicitly stated, and no guessed pay for
Competitive salary. Assert
evidence text and bucket/scope values, not only the total number of facts.

- [x] Run node --test --test-isolation=none test/job-intelligence.test.mjs test/resume-keywords.test.mjs. Verify new tests fail for missing exports or behavior before implementation; existing résumé cases must retain their expected values.
- [x] Implement the named pure interfaces. Preserve raw text; normalize whitespace/NFKC for hashes. Parse only recognized English sections/clauses, whole-number years and recognized date/age wording. Reject invalid/future date interpretation. Match location/remote evidence conservatively; unknown text stays raw and null-normalized. Do not derive required applicant years from team biographies or responsibilities. Add parser coverage for hourly/annual ranges only when amount/unit/paid meaning are explicit.
- [x] Rerun the focused command. Add cases for URLs, JavaScript domains, negation, mandatory versus preferred clearance, ambiguous education, mixed compensation, future/invalid dates, and unknown location. Confirm required education predicates retain all clauses or request review rather than choosing one arbitrary clause. Recognized explicit legal/authorization/sponsorship/citizenship conditions must retain their evidence and require review when no explicit matching fact resolves them; never silently treat a known eligibility condition as absent.
- [x] Commit the tested normalization deliverable, including test-command registration.

### Task 2: Validated preferences, hard decisions, and exact fit rubric

**Files:** Create src/intelligence-config.mjs, src/search-profiles.mjs, src/job-intelligence.mjs. Modify src/domain.mjs defaultConfig/validateConfig/readiness; extend test/job-intelligence.test.mjs, test/domain.test.mjs, test/store.test.mjs and test/server.test.mjs.

**Interfaces:**
- defaultIntelligenceConfig() -> IntelligenceConfig and validateIntelligence(input) -> IntelligenceConfig.
- roleFamilyPresets -> finite definitions for swe/development/web/backend/data/it/research/student, each with label, default internship/student titles, accepted related families, and aliases. Keep custom titles editable and preserved. AI/ML-specific titles can be explicit custom entries; do not infer that qualification.
- buildSearchQueries(search,intelligence) -> [{id,title,location,workplace,priority,familyId}]. Combine selected preset/override titles and custom search.titles with explicit regions; fallback to existing location/workplace. Deduplicate normalized combinations. Reject enabled expansions over 50, never silently truncate. Return no queries for incomplete input.
- Enabled readiness accepts selected-family titles without custom search.titles and regions without search.location; it requires at least one complete generated query. Disabled readiness retains its existing title/location requirements. Partial settings remain saveable in either mode.
- evaluateJob(job,config,{now}) -> Assessment. Include terms are explicit interest preferences when enabled, never confirmed skills; take the maximum of company/family interest and the fraction of included terms matched, each scaled to 5 points. All other factor formulas and weights follow the specification exactly.

- [x] Write tests asserting defaults/legacy round-trip, explicit false/zero/empty/null preservation, query generation and the 50-query bound, incomplete-save versus readiness, exact factor points, required/preferred weighting, score rounding, 55/70/85 bands, configurable threshold 55–100, and review overriding a passing score for unknown strict requirements.

```js
assert.equal(defaultIntelligenceConfig().enabled, false);
assert.equal(defaultIntelligenceConfig().minimumFitScore, 70);
assert.equal(validateIntelligence({candidate:{professionalYears:0,student:false,skills:[]}}).candidate.professionalYears, 0);
assert.equal(validateIntelligence({candidate:{skills:null}}).candidate.skills, null);
assert.throws(() => validateIntelligence({minimumFitScore:54}), /55/);
assert.throws(() => validateIntelligence({minimumFitScore:101}), /100/);
```

Build explicit normalized fixtures and assert factor values: required Python/Git
and preferred AWS/SQL with confirmed Python/Git/AWS earns 25*7/8=21.875 technical
points. No weighted posting skills earns 12.5 unknown; an empty confirmed list
with weighted skills earns 0. Evaluate known posting ages 0/1/3/4/7/8/14/15/30/31
days with recency 10/9/9/7/7/4/4/2/2/1. A 65-point eligible job reviews at threshold
70 and applies at threshold 60; any unknown strict eligibility still reviews.

- [x] Run node --test --test-isolation=none test/job-intelligence.test.mjs test/domain.test.mjs test/store.test.mjs test/server.test.mjs and observe the new failures.
- [x] Implement settings validation and pure scoring. Keep hard-rejected score null. Distinguish mandatory applicant facts from preferred qualifications; do not infer citizenship, visa status, lower degrees, missing experience, or an active clearance. Derive entry-only target intent from explicit internship/entry-level selections or selected internship families, not the applicant's age/name. Invalid/unreadable descriptions cannot become passing assessments.
- [x] Rerun focused tests. Add known compatible/incompatible/unknown qualification triples; contradictory senior/intern wording; negated requirements; include-keyword preferences with unreviewed skills; preferred gaps without hard rejection; exclusions independent of score; and maximum score/clamping/stable output under an injected clock.
- [x] Commit the tested opt-in preferences and fit engine.

### Task 3: Fair bounded search discovery and isolated posting metadata

**Files:** Modify src/browser/linkedin.mjs discovery/inspection only, test/fixtures/linkedin.mjs, and test/adapter.test.mjs. Extend test/job-intelligence.test.mjs query cases as needed. Do not change browser/forms.mjs, session ownership, or application button/field actions.

**Interfaces:**
- Existing findJobs(search,{scanLimit,signal,intelligence}) yields existing job IDs/URLs/titles/companies. intelligence is optional; enabled=false retains title-first legacy pagination.
- Enabled discovery consumes buildSearchQueries, preserves known Easy Apply/workplace/confirmed experience filters, and owns buffered cards/per-query page cursors. Use ceil(remainingBudget/remainingQueries) as that query's per-round candidate quota. Duplicate IDs do not spend candidate budget. Consume buffers before advancing a page; preserve existing bounded page range and cancellation checks.
- inspect(job,{signal}) keeps existing fields and adds only optional raw posting metadata/evidence from visible primary job-header content. Prefer a known time[datetime] or recognized posted-age text; keep unrecognized text raw. Do not wait an action timeout for optional missing metadata.
- Fixture additions: state.searchPageFor(params) -> card array, optional async state.beforeSearch(params,req,res), state.postingFor(id) -> synthetic posting metadata/description, and state.views -> requested IDs. Keep absent-hook scenarios unchanged.

- [x] Add fixture-driven tests for location/workplace/date extraction, missing/unrecognized/hidden/related-job metadata, all query parameters, round order, per-round quotas, buffer reuse, slugged duplicate IDs, scanLimit below query count, and cancellation before/during/after navigation. Extend fixture hooks first without changing existing scenario defaults.

```js
assert.deepEqual(firstRoundContributions, [2,2,1]); // 3 queries, scanLimit=5
assert.equal(new Set(jobs.map(job => job.id)).size, jobs.length);
assert.equal(jobs.length, 5);
assert.deepEqual(roundRequests.slice(0,2).map(q => q.start), ['0','0']);
assert.equal(queries.every(q => q.f_AL === 'true'), true);
assert.equal(fixture.state.views.length, 0); // discovery never opens forms/jobs
```

For buffer reuse, A first page has six cards; B/C first page have one each;
scanLimit=10. Require four A plus one B/one C in round one, two buffered A plus
one B/one C next-page candidates in round two, and no A page-25 request.

- [x] Run npm run test:browser with the new adapter cases present and record their expected failures. Use existing setup(t,scenario,timeouts), fixture state hooks, and temporary synthetic data; release pending request gates in finally.
- [x] Implement the discovery branch and metadata extraction. Keep existing experience-filter discovery/confirmation and job-description isolation. On disabled matching, ignore stored expanded profiles and preserve original titles × single-location pagination. Do not replace browser cancellation semantics or add generalized retry behavior.
- [x] Run PLAYWRIGHT_BROWSERS_PATH=./data/browsers node --test --test-isolation=none test/adapter.test.mjs, then npm run test:browser if shared fixtures changed. Assert no search/view/review/submission after cancellation and zero contamination from hidden/related-job facts.
- [x] Commit fair discovery and optional metadata with its fixture regressions.

### Task 4: Strong duplicate protection and ranked runner integration

**Files:** Create src/job-duplicates.mjs. Modify src/runner.mjs selection branch only; extend test/job-intelligence.test.mjs and test/runner.test.mjs. Use existing store record metadata without a new file or application state.

**Interfaces:**
- jobFingerprint(job) -> fingerprint string/null from known company, equivalent title, known location, and normalized description hash. Normalize NFKC/whitespace/case; title equivalence uses only explicit phrase aliases and preserves internship/seniority/employment qualifiers. A role-family ID alone is insufficient. Company/title placeholders and unknown location return null. Hash the stable tuple; do not merge merely similar descriptions or different workplace/location evidence.
- blockingDuplicate(job,history) -> record/null using same IDs or equal nonnull fingerprint plus the existing blocksRetry(record) predicate; recompute from sufficient old job facts when no fingerprint is stored, never fabricate absent metadata.
- compareCandidates(a,b) -> descending assessed score, then known posting freshness, then stable discovery index. Unknown freshness follows known freshness only within an equal score.
- Existing createRunner contract remains unchanged. Enabled run collects, inspects/normalizes/assesses, selects strong representatives, attaches assessment/fingerprint before record creation, sorts, and applies. Disabled run retains existing event order and keyword behavior.

- [x] Extend runner setup's observed events and optional synthetic details/jobs without changing defaults. Write tests for higher-fit job applied first, all discovery before inspections in enabled mode, skipped/review decisions never applied, known freshness/stable ties, duplicates, unreadable descriptions halting before queued candidates, and legacy streaming. An already-attempted same ID skips inspection; explicit equivalent-title aliases can fingerprint-match, while intern/senior qualifiers, changed workplace/location, or materially different descriptions prevent a cross-ID match.

```js
assert.deepEqual(legacyEvents.slice(0,6), ['discover:1001','inspect:1001','apply:1001','discover:1002','inspect:1002','apply:1002']);
assert.deepEqual(observed.applications.map(a => a.job.id), ['1002','1001']);
assert.equal(blockingDuplicate(repost, [{job:original,status:'failed',attemptedAt:'2026-10-04T12:00:00Z'}])?.job.id, original.id);
assert.equal(blockingDuplicate(repost, [{job:original,status:'failed',attemptedAt:null}]), null);
assert.equal(blockingDuplicate(differentLocation, history), null);
assert.equal(blockingDuplicate(differentDescription, history), null);
```

- [x] Run node --test --test-isolation=none test/job-intelligence.test.mjs test/runner.test.mjs and verify the new cases fail before implementing ranked selection.
- [x] Check same-ID durable history before inspection. After assessment, select strong representatives by highest-score/newest/stable order and persist a readable duplicate reason for suppressed IDs. Recheck ID/fingerprint history and cap before each ranked job and again after pacing before reservation. Preserve recordOutcome, answer/resume snapshot, beforeSubmit single reservation, attemptedAt counting, confirmation/unconfirmed policy, and close/Stop behavior. Do not reserve anything during discovery/scoring.
- [x] Rerun focused tests and existing cap, pacing, recovered pending, dry-run, Stop, limit, and snapshot tests. Add a history insertion during the pacing wait that creates an attempted same-ID/fingerprint record; assert no second reservation/attempt. Test Stop during collection and inspection with zero applications, and Stop after reservation preserving uncertainty.
- [x] Commit the verified ranked selection and duplicate protection.

### Task 5: Usable matching settings and fit explanations

**Files:** Modify public/index.html, public/app.js, public/styles.css, src/server.mjs only if additive bootstrap metadata is needed, README.md, test/dashboard.test.mjs, and test/server.test.mjs.

**Interfaces:**
- Existing /api/config stores top-level intelligence using validated defaults; partial setup remains saveable. /api/bootstrap includes that config and existing histories with job.assessment/job.fingerprint.
- Settings adds Enable intelligent matching, minimum score, confirmed-skill review/edit controls, explicit matching facts, editable family titles, regions/priorities/workplace, exclusions, and company/role preferences. Keep existing profile, résumé, keyword controls and location input behavior.
- Existing result rendering adds score/band and expandable earned/max points, matched/missing skills, uncertainty and reasons; review decisions explain no attempt without claiming submission. Do not create outcome analytics or a persistent queue.

- [x] Write browser/API regressions for default off, exact settings round-trip/reload, family-only readiness without custom titles, multiple regions, reviewed-empty versus unreviewed skills, false/zero facts, invalid thresholds/query expansion errors, and existing unsaved profile/search edits surviving keyword recommendation actions.

```js
assert.equal((await store.getConfig()).intelligence.enabled, false);
assert.equal((await store.getConfig()).intelligence.candidate.student, false);
assert.equal((await store.getConfig()).intelligence.candidate.professionalYears, 0);
assert.equal((await store.getConfig()).intelligence.minimumFitScore, 60);
assert.deepEqual((await store.getConfig()).search.includeKeywords, ['Remote','Python']);
assert.equal(await page.getByText('Fit: 85/100',{exact:true}).isVisible(), true);
```

- [x] Run node --test --test-isolation=none test/server.test.mjs and PLAYWRIGHT_BROWSERS_PATH=./data/browsers node --test --test-isolation=none test/dashboard.test.mjs using settingsPage and existing temporary stores. Observe failing selectors/round-trips, not mocked replacement scoring behavior.
- [x] Implement the controls and serialization with clear labels distinguishing current from completed education and matching facts from application answers. Add an explicit Add selected skills action for résumé suggestions; preserve the existing Add selected keywords action and guards. A profile/common screening answer is never generated from these matching fields. Show that lowering minimum below 70 permits Borderline jobs.
- [x] Run focused tests, the complete npm test and npm run test:browser suites, and desktop/390px screenshots. Verify no overflow, canonical skill labels, full factor explanations, draft preservation, and unchanged Settings/Answers/History/dry-run behavior.
- [x] Commit this independently usable job-selection workstream and document its opt-in behavior. Continue only to the Phase 1 question plan, not Phase 2.
