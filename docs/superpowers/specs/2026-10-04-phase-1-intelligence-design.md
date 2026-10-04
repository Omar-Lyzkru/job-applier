# Phase 1 — Intelligence

Date: October 4, 2026

## Purpose and approval

Improve the relevance and ordering of discovered jobs, reduce repeated question
cards, and reuse explicitly saved answers for recognized equivalent wording.
The user approved this Phase 1 design in chat. This document makes its rules and
acceptance criteria concrete before implementation planning.

The project must proceed one phase at a time. Phase 1 must be implemented,
tested, and summarized before stopping for the user's approval of Phase 2.
Phases 2–6 are not authorized by approval of this document.

## Scope

- A local, deterministic Job Fit Engine with normalized requirements, skill
  aliases, hard filters, a score breakdown, and clear selection reasons.
- Configurable role families and search regions, bounded fair discovery,
  conservative duplicate detection, and ranking before application attempts.
- Better known-question recognition and compatible pending-question grouping,
  retaining explicit answers, drafts, employer scope, and per-job failures.
- Settings and concise fit information necessary to use and review these
  features, together with unit, API, runner, and browser tests.

No LLM service, API key, new external source, résumé generator, or database
migration is introduced. Work stays local. Existing submission behavior remains
controlled by the current dry-run switch, caps, pacing, and durable guard.

## Existing code and constraints

The runner currently streams discovery → inspection → keyword matching →
application. It cannot compare scores across the bounded scanned set. Discovery
searches all titles at one location, so early queries can consume the scan limit.
Inspection returns description, Easy Apply availability, and already-applied
state; posting location and age are not currently extracted.

Configuration validation and Settings saving rebuild allowlisted fields. Both
must support the new settings explicitly. History already clones the complete
job object, so assessment metadata can be stored without changing the durable
application state model.

The answer resolver already supports exact and known-equivalent answers,
conflicts, choice compatibility, graduation formats, scoped SMS consent, and
review-only fuzzy suggestions. Pending occurrences are stored per job and
question; the dashboard renders every occurrence as a separate card. Exact
saved labels intentionally override equivalent aliases.

## Job facts and configuration

Normalize each inspected posting into one job object retaining the source ID,
URL, original title/company/description, and the extracted evidence. Add:

- Normalized title, company, location, role family, and experience level.
- Remote/workplace information, employment type, and known compensation facts.
- Required, preferred, optional, and unclassified technical skills.
- Explicit experience, student, education, and restricted-clearance requirements.
- Posting age when shown by the posting, and Easy Apply availability.
- Description hash, fit assessment, and duplicate evidence.

Missing facts remain unknown. Preserve each extracted requirement's supporting
text. Do not interpret benefits, company history, related jobs, or desirable
qualifications as mandatory requirements. Unrecognized salary ranges, posting
dates, or location wording must not become invented normalized values.

Add separate matching facts in Settings: confirmed skills, professional years
when known, current student status, and current/completed education when known.
Include explicitly confirmed existing clearances, with unknown kept distinct
from a confirmed empty list. Skills and clearances use null for unreviewed facts
and an array for confirmed facts; an empty confirmed array is a deliberate
statement of no listed qualifications. The UI requires explicit confirmation
before turning an unreviewed empty skills field into a confirmed empty list.
These are job-selection facts; they do not create form answers. Existing search
keywords are preferences, not proof of a skill. Résumé recommendations may be
added to confirmed skills only through an explicit user selection and save.

Intelligent matching is opt-in. Legacy configurations keep their current search
behavior until enabled; the new controls explain how to enable it. This avoids
silently treating existing keywords or missing applicant facts as qualifications.
With matching disabled, existing include/exclude keyword behavior stays intact.
The existing streaming search/inspect/apply path and its title ordering also
remain intact. Expanded-profile discovery and collection/ranking run only when
intelligent matching is enabled. Question grouping is independent of that toggle.
With matching enabled, confirmed skills influence fit; exclusions remain hard
user rules, and include terms become weighted preferences rather than the only
qualification test. The UI explains this change at the toggle.

## Skill normalization and parsing

Use one explicit vocabulary for equivalent spellings, extending the existing
résumé keyword vocabulary where appropriate. Examples include JS/JavaScript,
React.js/ReactJS/React, CPP/C++, Node.js/NodeJS, and Postgres/PostgreSQL.
Preserve boundaries: Java is not JavaScript, C is not C++, and skill names in
URLs or unrelated prose are not qualifications.

Classify skills by recognized section headings and requirement wording.
Required skills receive three times the influence of preferred skills in the
technical match factor. Unknown section meaning is labeled unclassified rather
than assumed required. Missing preferred skills cannot alone cause rejection.
Do not equate GitHub use with all Git expertise or general experience with
professional years merely because the terms are related.

## Hard rules and fit score

Hard decisions run before scoring and carry specific reasons. Honor explicit
exclude terms and company exclusions. When enabled by the user's settings,
recognizable unpaid and commission-only roles are rejected. Senior, staff,
principal, director, or executive roles are rejected when the selected search
profile explicitly targets internships or entry-level work.

An explicit incompatible required experience, degree/student status, or existing
clearance can reject a posting only when the corresponding applicant fact is
known. Unknown facts needed to resolve those explicit requirements require
review. Work authorization, sponsorship, citizenship, and legal eligibility are
never inferred from names, school, location, résumé keywords, or experience.
Ambiguous eligibility wording requires review rather than automatic rejection
or automatic application.
An unreadable or empty description cannot receive midpoint scores and pass:
record the existing description-inspection failure and stop that run before
applying queued candidates, because exclusions and requirements were not checked.
Recognized requirement extraction must respect negation, preferred wording,
and whose experience is described. Base pay plus commission is not commission
only; mentorship from experienced colleagues is not an applicant requirement.

Use this transparent 100-point rubric:

| Factor | Maximum points |
| --- | ---: |
| Title and selected role-family match | 20 |
| Technical skill match | 25 |
| Experience-level match | 15 |
| Education/student eligibility | 10 |
| Location preference | 10 |
| Posting recency | 10 |
| Known application ease | 5 |
| Explicit company or role interest | 5 |

Each assessment records earned/max points, matched/missing skills, supporting
evidence, and uncertainties. Unknown factors earn half their weight and are
marked unknown; they cannot satisfy a required eligibility rule. These points
are a deterministic rubric, not a calibrated probability of hiring success.

Factor calculations are:

- Title: 20 for a recognized selected family or equivalent explicit custom
  title; 10 for an explicitly related family accepted by that profile; 0 for a
  recognized unrelated family. Unknown classification receives 10.
- Skills: canonicalize and deduplicate each bucket; required takes precedence
  over preferred. Earn 25 multiplied by matched weight / listed weight, with
  required weight 3 and preferred weight 1. Optional and unclassified skills
  are reported with weight 0. No weighted posting skills, or an unreviewed
  candidate skill list, receives 12.5 unknown points. A confirmed empty list
  receives 0 when the posting has weighted skills.
- Experience: 15 for a recognized compatible selected level and satisfied
  explicit years requirement; 0 for a known incompatible soft preference;
  7.5 when the level or necessary comparison fact is unknown. An explicit
  incompatible required minimum is a hard decision, not a soft preference.
- Education: 10 when all recognized education/student requirements and
  preferences are explicitly satisfied; 0 for known incompatible preferred
  education; 5 when the necessary comparison is unknown or the posting has
  no recognized education information. Required incompatibility is hard.
- Location: the configured 0–10 priority for a verified matching region or
  verified remote role; use the greatest applicable priority once. Known
  outside-region locations receive 0, and unknown locations receive 5.
- Recency: use the age bands below. Convert an injected current time and known
  posting time to nonnegative whole days; future or invalid dates are unknown.
- Application ease: 5 for verified Easy Apply, 0 for verified external forms,
  and 2.5 if unavailable. External forms remain excluded by current support.
- Interest: 5 for an explicit preferred company or prioritized role family;
  0 for a known nonpreferred company when a preference list is set; 2.5 when
  no preference is set or company identity is unknown. Exclusions remain hard.

Clamp each factor to its maximum and round the sum to the nearest whole point
in 0–100. Use that displayed total for band and threshold decisions. Keep the
unrounded factor breakdown. Hard-rejected postings need not be scored and show
their rejection reason instead of a fabricated low score.

Default bands are Excellent 85–100, Good 70–84, Borderline 55–69, and Low 0–54.
The minimum application score is an integer from 55–100, initially 70. A passing score
cannot override a hard rejection or an unresolved required eligibility fact.
Scores below 55 are skipped; scores from 55 up to the configured minimum require
review. Scores at or above the configured minimum may proceed when every hard
rule passes. Lowering the minimum below 70 explicitly permits Borderline jobs,
and Settings explains that effect. Required eligibility uncertainty always
needs review regardless of score. Review decisions use the existing skipped
record with a clear review reason; they do not gain a new application state or
resume workflow in this phase.

For known posting ages, recency contributes 10 points under 24 hours; 9 for
1–3 days; 7 for 4–7; 4 for 8–14; 2 for 15–30; and 1 over 30. An unavailable
posting age contributes the defined unknown midpoint. Do not estimate form
length or a completion time before that information is available.

## Searches, duplicates, and ranking

Offer editable role-family presets for software engineering/development, web,
backend, data, IT development, undergraduate research, and student development.
Selecting a family adds its explicit related titles; it does not select every
family automatically. Support several explicit regions with location priority,
including a remote query when selected. Preserve the existing custom titles
and single location as the legacy fallback.

Build validated title/region/workplace queries. Cap the expanded query list at
50 and reject larger expansions with a Settings validation error instead of
silently dropping selected queries. Paginate in rounds, giving selected queries
their first page before advancing a previous query, subject to cancellation and
the global scan bound. Allocate each query a per-round candidate quota from
the remaining scan budget and remaining queries so one full page cannot consume
the budget before the other queries get a turn. Keep surplus collected cards
for later rounds before fetching that query's next page. Keep one global
unique-job scan limit and the existing bounded pagination. When the scan budget
is smaller than the query count, only that bounded number can receive candidates;
the UI does not promise full coverage. Fairness is within the configured scan.

Collect unique discovered IDs first, then inspect sequentially with cancellation
checks. Perform hard rules, normalization, scoring, and strong duplicate checks
before building the ranked in-memory candidate list. Apply highest score first,
then known freshness, then stable discovery order. Recheck durable history and
the cap immediately before processing every ranked candidate and preserve the
existing before-submit guard, reservation, pacing, and uncertainty handling.
Perform the same ID/fingerprint history check again in the before-submit guard,
after any pacing wait and before creating the submission reservation.

Same IDs remain duplicates. Across IDs, automatic duplicate suppression needs
the same normalized company, equivalent title, known location, and normalized
description hash. Placeholder company/title or unknown location is insufficient.
Different locations and materially different descriptions remain distinct.
Weaker similarity is an explanation for review only. Across runs, an attempted
equivalent posting blocks an automatic attempt. Reuse the existing blocksRetry
predicate for both ID and fingerprint checks, including any attemptedAt value
regardless of its record's status. A prior unattempted skipped, failed, or
needs-answer occurrence must not permanently suppress an eligible retry.

Attach the assessment and fingerprint to the job before record creation.
Show a concise fit score/band and human-readable selection reason in the
existing result views. Retain breakdowns for inspection. Do not add a persistent
application queue, new application states, or outcome analytics in Phase 1.

## Question matching and repeated cards

Expose question meaning, answer key, scope, match method, and review policy from
the existing classifier. Expand finite, reviewed aliases for common education,
student status, and skill-experience questions. Keep current versus completed
education, total versus professional experience, skill identity, country,
negation, and sponsorship time scope distinct. Any ambiguous variation remains
a suggestion requiring user review and save.

Apply sensitive-word exclusions to both the requested question and proposed
saved-question candidates. A generic question must not surface an unrelated
legal, consent, salary, or certification answer merely because tokens overlap.
Known explicit legal answers can still match their existing recognized meaning.
No screening answer is inferred from the résumé or matching profile.

Produce additive question groups at bootstrap while preserving raw pending
occurrences. Group only the same answer key with compatible control type,
choice meanings, format constraints, reuse scope, and current saved resolution.
Different employers' SMS answers stay separate. Conflicting resolutions,
different choices, and differing date formats remain separate groups. Do not
rewrite existing answer keys or silently replace exact-answer precedence.

Render one heading/editor per group with a count and expandable affected jobs.
Every job retains its own blocker and reason. Saved values remain visible,
including No and zero. Unsupported controls still explain manual completion.
Saving updates the group's existing answer key once; it does not erase an
operational failure or claim that LinkedIn accepted the answer.

Use stable group identifiers incorporating answer key and immutable control,
choice, format, and scope constraints for draft isolation. Do not include saved
values, resolution/provenance, blockers/reasons, job membership, or ordering in
the draft identifier. Membership changes keep the draft for that compatibility
identity. If saved-resolution conflicts split a group, keep the shared draft as
a retained edit requiring explicit selection/save; never silently apply it to
conflicting subgroups. A genuinely changed control/choice/format identity does
not inherit an incompatible draft; retain that edit separately for review.
Polling, unrelated saves, group-order changes, and failed saves must preserve
unsaved drafts. Use distinct-question counts in question badges and
show affected-application counts alongside them. Actual raw occurrences remain
available to the runner for later verified retries.

## Component boundaries and likely files

Add pure job-intelligence, search-profile, skill-normalization, and
question-grouping modules, with deterministic inputs/outputs that are testable
without a browser or private applicant data.

Update domain configuration/resolution metadata, runner candidate selection,
LinkedIn discovery/inspection metadata, bootstrap groups, Settings controls,
and result/answer rendering. Expected existing files include src/domain.mjs,
src/runner.mjs, src/browser/linkedin.mjs, src/answer-memory.mjs, src/server.mjs,
src/resume-keywords.mjs, public/app.js, public/index.html, public/styles.css,
package.json, README.md, and docs/verification.md. Avoid unrelated refactors.

## Verification and completion criteria

Add failing tests before each behavior change, then run focused regressions and
the complete unit/API and browser suites. Use synthetic fixture data only.

- A suitable software internship outranks an explicitly unsuitable senior role
  even when both contain Python/C++. A hard rejection cannot be overridden by
  its raw score. Unknown required facts never become invented qualifications.
- Required/preferred extraction and aliases work without substring collisions,
  related-job contamination, or false experience/education inference.
- Threshold boundaries, recency boundaries, stable ties, and explicit score
  breakdowns are deterministic. Legacy configurations keep their behavior;
  new settings persist and survive unrelated saves and reloads.
- Queries cover selected families/regions in rounds under one global bound;
  duplicate IDs do not consume repeated application attempts.
- Strong cross-ID reposts are suppressed; different locations/descriptions and
  unattempted retryable histories are preserved.
- The runner ranks before applying and maintains Stop, caps, pacing, dry run,
  reserved submission, and uncertain-submission protections.
- Repeated compatible questions render once with all job links/reasons. Choices,
  date formats, companies, conflicts, and risk contexts stay separated. Saving,
  reloading, draft preservation, false/zero values, and rejected saves work.
- Expanded aliases retain legal country/negation/time safeguards and separate
  total/professional skill experience. Sensitive candidates cannot leak into
  generic fuzzy suggestions. Every reused answer identifies its source.
- Desktop/mobile screens remain usable without horizontal overflow. No live
  application is submitted or real stored answer changed during verification.

Completion requires a Phase 1 summary of implemented behavior, changed files,
tests and results, discovered limitations, and deferred work. Stop immediately
after that summary and wait for explicit approval before beginning Phase 2.

## Deferred work and practical limits

Phase 2: browser radio-entry timeouts, selector/control reliability, conditional
form rescanning, validation/retries, persistent application states/recovery,
failure snapshots and classifications, and resumable attention queues.

Phase 3: broader application intelligence, risk-aware application review objects,
context-dependent answer-bank redesign, and richer application workflows.

Phase 4: multiple approved résumé routing, structured résumé facts, and validated
tailoring. Phase 5: recruiter outcomes, funnel analytics, and expanded history.
Phase 6: additional sources and cross-source opportunities.

Some known-question recognition is included in Phase 1 because the user
explicitly requested it here. English deterministic parsing cannot interpret
every employer's wording. Unknown facts and uncertain duplicates remain review
cases. Fixture tests do not prove compatibility with every live LinkedIn layout.
Ranking the best jobs does not repair the existing LinkedIn entry timeout; that
remains an explicit Phase 2 limitation.
