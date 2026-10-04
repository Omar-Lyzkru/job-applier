# Phase 1 Question Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse known explicit answers safely and show compatible repeated questions once without losing job-specific failures or drafts.

**Architecture:** Extend the existing meaning classifier rather than replacing answer storage. A pure grouping helper prepares additive bootstrap groups; the dashboard renders one editor plus affected occurrences and retains drafts by immutable compatibility identity. Saved exact keys and employer-scoped SMS remain authoritative.

**Tech Stack:** Existing Node.js ESM/node:test, local JSON store, Playwright dashboard tests, and HTML/CSS/JavaScript; no dependencies or answer migration.

**Spec:** ../specs/2026-10-04-phase-1-intelligence-design.md

## Global Constraints

- Read and obey 2026-10-04-phase-1-intelligence.md and its final integration gate.
- No screening answer is inferred from the résumé or matching profile.
- Unknown facts and uncertain duplicates remain review cases.
- Exact saved labels intentionally override equivalent aliases.
- Saving updates the group's existing answer key once; it does not erase an operational failure or claim that LinkedIn accepted the answer.
- Use synthetic fixture data only. No live applications or changes to real stored answers during verification.
- Browser radio-entry timeouts and collision-safe saved-key migration are deferred; do not alter browser/forms.mjs or persisted answer identities to implement this workstream.

## Review Focus

- C/C++/C# keys can collide after punctuation normalization: guard recognized ambiguous experience questions rather than guessing (Task 1).
- Total, professional, current, completed, country, time, and negation qualifiers must stay distinct (Task 1).
- Sensitive saved questions cannot become generic fuzzy suggestions through asymmetric filtering (Task 1).
- Same-key questions with different choices, formats, scope, or resolutions must not share one editor (Task 2).
- Saved-value or membership changes must not lose a draft or silently place it into conflicting/new-format controls (Task 3).

## File map and contracts

Extend src/answer-memory.mjs for meaning metadata/finite aliases/risk guards;
create src/question-groups.mjs for compatibility grouping; update bootstrap in
src/server.mjs and grouped rendering in public/app.js, public/index.html, and
public/styles.css. Existing src/domain.mjs resolveAnswer is retained as the
authoritative type/choice validator; only change it if a named compatibility
test demonstrates a necessary defect within this phase.

QuestionDescription is {intent,answerKey,scope,controlType,reviewPolicy,risk}.
Scope carries global/company identity, skill ID and experience kind where
recognized, and original ambiguous C-family identity when guarded. reviewPolicy
is known/review/manual; risk is ordinary/sensitive/ambiguous_identity. No numeric
probability claims. answerKey remains savedAnswerKey(field), not a new canonical
storage key. Metadata explains recognition without changing the existing
resolution shape/provenance contract unnecessarily.

QuestionGroup is {id,draftId,question,occurrences,savedAnswer,suggestions}.
Occurrences retain jobId/company/label/control type/blocker/reason and the
original question. draftId hashes immutable answerKey/control/choices/format/
scope compatibility. id also distinguishes current saved-resolution conflicts
for rendering, while draftId never includes mutable saved values, provenance,
blocker/reason, membership, or order. Choice identity preserves meaningful
punctuation and compares displayed labels rather than opaque values.

### Task 1: Known question meanings and symmetric risk filtering

**Files:** Modify src/answer-memory.mjs and test/domain.test.mjs; add API/common-bank cases to test/server.test.mjs when exposing the new current-student bank entry.

**Interfaces:**
- describeQuestion(field) -> QuestionDescription; consumed by saved matching and later grouping/bootstrap.
- findSavedAnswer(field,answers) retains exact-then-equivalent-then-review-only-suggestion ordering. Existing known legal/SMS/date rules remain authoritative. Use the original label to detect skill identity before lossy general normalization.
- Add one blank Yes/No common question: Are you currently a student? Matching-profile student facts never supply its answer.

Finite new aliases are current-student (currently a student/current student/
presently a student); current school/degree/major wording (Name of your current
university, Current degree, Current field of study); and skill-year templates.
Current-student does not answer college, undergraduate, full-time, accredited,
future enrollment, degree-specific eligibility, or negated student questions.
These remain separate or review-only.

The initial skill list is Java; JavaScript/JS/ECMAScript; TypeScript; Python;
Rust/Rust programming; React/React.js/ReactJS; Node.js/NodeJS/node js; SQL;
PostgreSQL/Postgres; Git. Recognize normalized stored spellings only when
unambiguous. Exclude C/C++/C# from new automatic alias recognition, and guard
recognized experience questions with ambiguous C-family old keys for manual
review before exact reuse. Preserve their original skill identity in metadata
so incompatible C-family questions do not group together. Do not rewrite keys.

Instantiate only these entire-label templates (punctuation/required stars may
be normalized around them):

- Total: Years of {skill} experience; Years of experience with {skill}; How many
  years of {skill} experience do you have?; How many years of experience do you
  have with/in {skill}?; Total years of {skill} experience; Total years of
  experience with {skill}.
- Professional: Years of professional {skill} experience; Years of professional
  experience with {skill}; How many years of professional {skill} experience do
  you have?; How many years of professional experience do you have with/in {skill}?

Intent is skill-years:total:<skillId> or skill-years:professional:<skillId>.
Production/commercial/paid/recent/continuous/full-time and multi-skill qualifiers
are not erased. A numeric/text scalar years answer must be a nonnegative finite
number or numeric string; booleans and prose are not inferred into years. For
offered range/choice answers, existing displayed-choice compatibility still
controls and cannot be converted into a fabricated scalar.

- [ ] Add table tests for every finite template, same-skill aliases, Java versus JavaScript, zero/decimal values, exact precedence, conflicting equivalent values, total versus professional scope, and all excluded qualifiers. Assert false and No agree for known current-student meaning while no value is preselected.

```js
const field={label:'How many years of experience do you have with Python?',type:'number'};
assert.equal(resolveAnswer(field,{}, {'years of python experience':0}).value, '0');
assert.equal(resolveAnswer({...field,label:'How many years of professional experience do you have with Python?'},{},{'years of python experience':2}).kind, 'missing');
assert.equal(resolveAnswer({label:'Are you presently a student?',type:'radio',options:[{label:'Yes',value:'on'},{label:'No',value:'on'}]}, {}, {'are you currently a student':false}).optionLabel, 'No');
assert.equal(resolveAnswer({label:'Years of C++ experience',type:'number'}, {}, {'years of c experience':2}).kind, 'missing');
```

- [ ] Run node --test --test-isolation=none test/domain.test.mjs test/server.test.mjs; verify new regressions fail before matching changes.
- [ ] Implement finite whole-label meanings and source provenance reuse. Preserve source screening labels as keys; never use matching-profile/resume facts as answers. Extend semantic yes/no comparison only for known student status. Make sensitive suggestion exclusion symmetric on requested and candidate questions, including legal, authorization, sponsorship, consent/SMS, salary/pay, certification, clearance and identity terms. Exact explicitly saved sensitive answers still follow existing guards.
- [ ] Rerun focused tests. Add current/completed education, country/negation/sponsorship time, SMS employers, numeric versus offered range, invalid scalar years, punctuation collisions, and a generic request whose overlapping sensitive candidate must be absent. Assert existing question bank/screening behavior and exact key storage are unchanged.
- [ ] Commit tested question recognition and risk guards.

### Task 2: Pure compatible groups and additive bootstrap metadata

**Files:** Create src/question-groups.mjs and test/question-groups.test.mjs. Modify src/server.mjs and package.json's test enumeration; extend test/server.test.mjs.

**Interfaces:**
- groupPendingQuestions(questions) -> QuestionGroup[]. Inputs are derived bootstrap questions with describeQuestion metadata and saved resolution, never mutable store references.
- /api/bootstrap keeps questions as raw visible occurrences and adds questionGroups plus questionCounts={distinctQuestions,affectedApplications,occurrences}. affectedApplications counts distinct known job IDs, not guessed companies. Groups retain enough original job context when the associated history is outside its latest-200 response.
- Compatibility includes answerKey, control type, unique offered meanings, required/read-only semantics, explicit pattern and date/placeholder format, and reuse scope. Respect min/max/step constraints if present, without adding browser discovery changes in this phase. Ignore transient browser control IDs and opaque option values in stable draft identity.

- [ ] Write pure/API tests: two same-key operational occurrences group once but remain two raw store entries; distinct type/options/date formats/SMS employer or unknown-employer job remain separate; C/C++/C# ambiguity metadata stays separate; saved value/source/reason/order/membership changes leave draftId stable. Synthetic conflicting saved resolutions share compatibility draftId but render distinct id values.

```js
assert.equal(groups.length, 1);
assert.equal(groups[0].occurrences.length, 2);
assert.equal(changedSavedValue[0].draftId, groups[0].draftId);
assert.equal(reorderedOccurrences[0].draftId, groups[0].draftId);
assert.equal(splitConflicts.length, 2);
assert.equal(splitConflicts[0].draftId, splitConflicts[1].draftId);
assert.notEqual(splitConflicts[0].id, splitConflicts[1].id);
assert.equal((await store.getQuestions()).length, 2);
```

- [ ] Run node --test --test-isolation=none test/question-groups.test.mjs test/domain.test.mjs test/server.test.mjs and verify failures for missing grouping/bootstrap behavior.
- [ ] Implement deterministic grouping without sorting/mutating stored questions or rewriting answers. Stable stringify immutable descriptor keys before hashing. Split incompatible resolution/provenance states for display; coalesce duplicate suggestions by source question/value/reason only. Operational failures stay occurrence-specific. Attach known job title/URL from full history before slicing response history, so every affected job retains a usable source link.
- [ ] Rerun focused tests. Assert no store mutation, no removal of operational blockers after save, no extra answer write, false/zero display, grouping independent of intelligence toggle, and correct counts under missing/duplicate job IDs and more than 200 historical records.
- [ ] Commit pure grouping and additive API metadata.

### Task 3: One editor per group with durable save display and retained drafts

**Files:** Modify public/app.js, public/index.html, public/styles.css, README.md, and test/dashboard.test.mjs. Leave existing common/SMS/library draft handling intact.

**Interfaces:**
- renderQuestions consumes questionGroups and updates distinct-question badges plus affected-application count. Each group has one heading/editor/saved status and an expandable affected-jobs list retaining each original label, link, blocker and reason.
- Keep answerEditor(question,draftKey,savedValue) backward compatible; add an optional draft adapter {get,set,clear} for grouped pending editors. Ordinary/common/SMS editors keep their existing Map behavior and save API contract.
- Group drafts are {draftId,label,value,targetGroupId?}. A single current compatibility group may retain its draft across saved-value changes. If it splits, show a retained edit with explicit Use for this question buttons; neither subgroup receives it silently. If control/choices/format truly changes, show the old edit separately; do not fill a new incompatible editor. Clear only after successful save.

- [ ] Reuse answerMemoryPage(t,{answers,questions,employers}) and createRecord for two synthetic job links. Write tests proving one editor/two occurrence links/reasons, Saved answer: No after Save and reload, distinct-question versus affected-job counts, and one answer-key update with raw questions retained.

```js
assert.equal(await page.locator('#pending-questions .pending-question').count(), 1);
assert.equal(await page.getByLabel('Answer for '+label,{exact:true}).count(), 1);
assert.equal(await page.locator('#pending-questions a[href*="/jobs/view/"]').count(), 2);
assert.match(await page.locator('#pending-questions').textContent(), /Saved answer: No/);
assert.equal((await store.getQuestions()).length, 2);
```

- [ ] Run PLAYWRIGHT_BROWSERS_PATH=./data/browsers node --test --test-isolation=none test/dashboard.test.mjs and observe RED results before replacing per-occurrence rendering.
- [ ] Implement group rendering/draft adapters with safe text nodes and existing jobAnchor links. Use details/summary for affected applications; expose retained draft text and explicit target selection when needed. Preserve the last Save fix: successful POST refreshes saved status, rejected POST retains the draft and durable prior value, and operational failures are not hidden.
- [ ] Test polling add/remove/reorder via store.saveQuestions and page.waitForResponse('/api/bootstrap'); saved source updates while typing; split/merge conflicts; changed choices/formats; unsupported/manual C-family questions; false/zero; failed save using a 10001-character draft; and unrelated common/SMS/library edits. Assert a review suggestion is never saved without explicit selection/Save.
- [ ] Run complete npm test and npm run test:browser suites; inspect desktop and 390px screenshots without document overflow. Commit this independently usable question-intelligence workstream, then return only to the Phase 1 parent plan's final integration task.
