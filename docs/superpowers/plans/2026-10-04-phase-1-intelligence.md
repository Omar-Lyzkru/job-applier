# Phase 1 Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Rank suitable jobs before applying and reduce repeated questions through compatible grouping and explicit saved-answer reuse.

**Architecture:** Two independently testable workstreams share one Phase 1 boundary. Execute job selection first, then question intelligence, then verify the complete integration. Pure modules own parsing, scoring, query generation, duplicates, and grouping; the existing local application runner and storage protections remain intact.

**Tech Stack:** Node.js 24+, ECMAScript modules, node:test, Playwright 1.62.1, existing local HTML/CSS/JavaScript dashboard and atomic JSON store. No new runtime dependencies.

**Spec:** ../specs/2026-10-04-phase-1-intelligence-design.md

## Global Constraints

- The project must proceed one phase at a time.
- Phases 2–6 are not authorized by approval of this document.
- No LLM service, API key, new external source, résumé generator, or database migration is introduced.
- Work stays local.
- Intelligent matching is opt-in.
- Missing facts remain unknown.
- No screening answer is inferred from the résumé or matching profile.
- The minimum application score is an integer from 55–100, initially 70.
- Default bands are Excellent 85–100, Good 70–84, Borderline 55–69, and Low 0–54.
- Use synthetic fixture data only. No live applications or changes to real stored answers during verification.
- Existing submission behavior remains controlled by the current dry-run switch, caps, pacing, and durable guard.
- After completing and summarizing Phase 1, STOP and wait for explicit Phase 2 approval.

## Review Focus

1. Negated/soft requirements and experienced colleagues mentioned in a description must not become hard applicant requirements (job plan Task 1/2).
2. Null applicant facts, confirmed empty lists, unreadable descriptions, and legacy keywords must remain distinct (job plan Task 2/4/5).
3. A repost with changed location/description or an unattempted failure must remain retryable; any attemptedAt must prevent another attempt (job plan Task 4).
4. Query duplicates, cancellation, tiny scan budgets, and buffered cards must not starve all later queries or cause unbounded work (job plan Task 3).
5. Punctuation collisions, professional/total experience scope, and mutable question-group membership must not reuse the wrong answer or lose an unsaved edit (question plan Tasks 1–3).

## Plans and execution order

- [Job selection](2026-10-04-phase-1-job-selection.md), Tasks 1–5.
- [Question intelligence](2026-10-04-phase-1-question-intelligence.md), Tasks 1–3.
- Integration and phase handoff: the final task below.

Both workstreams implement this approved phase; they are not separate phases.
Finish each task's tests and review before starting dependent work. Do not run
concurrent edits to shared domain, server, dashboard, or fixture files.

## Preflight

- [x] Read the approved specification and both workstream plans. Check repository instructions and current uncommitted changes.
- [x] Use superpowers:using-git-worktrees at execution time. Inspect attached artifacts and reuse a suitable worktree; otherwise create one from the current reviewed main commit on codex/phase-1-intelligence. Use the managed tool when supported, with the skill's local fallback if necessary.
- [x] Keep production data and the running app in the primary checkout. Reuse installed node_modules and, if needed, link only data/browsers into a new otherwise empty worktree data directory. Do not link the production data directory, config, answers, questions, history, résumés, or browser profile. Use existing browser-runner environment settings; no dependency upgrades are needed.
- [x] Run npm test and npm run test:browser once in that isolated checkout. Expected baseline: 91 unit/API tests and 103 browser scenarios with zero failures. Investigate baseline failures before implementation.
- [x] Record the baseline and active checkout in this plan; leave public behavior and production data unchanged until integration.

## Final task: Verify and deliver Phase 1

**Files:** Update README.md, docs/verification.md, and task checkboxes in all three Phase 1 plans. No unrelated product changes.

**Interfaces:** Consume the completed two workstreams. Produce a runnable reviewed Phase 1 update and its verification record, with no later-phase implementation.

- [x] Run all newly added pure/API/runner regressions and the complete npm test and npm run test:browser suites; read actual output and record exact counts and failures. Run node --check on changed modules and git diff --check.
- [x] Review the integrated branch independently for specification coverage, unknown-fact handling, grouped-answer compatibility, private-data exclusion, and unchanged submission guards. Fix findings with failing regressions, then rerun the affected checks and complete suites if behavior changed.
- [x] Inspect fixture-based desktop and 390px mobile screenshots for Settings, fit details, grouped pending questions, saved values, retained drafts, and horizontal overflow. Capture proof without private applicant data.
- [x] Document how to enable intelligent matching, confirm skills, select families/regions, change minimum score, inspect explanations, and answer grouped cards. Explain that score is a rubric and that legal/consent answers stay explicit.
- [x] Integrate the verified branch according to existing repository/user authorization. Before restarting production, verify no active run; back up private config/answers/questions/history and compare contents after startup. If active, defer restart rather than interrupt it.
- [x] Read the updated local bootstrap and inspect the UI without editing real answers or submitting applications. Preserve stored data; report any live compatibility check that remains unverified.
- [x] Push the authorized code update only after checks pass. Verify the remote commit matches the local commit and exclude data, backups, screenshots, cookies, and résumé files.
- [x] Summarize implemented features, actual files changed, tests/results, limitations, and deferred work. STOP. Do not begin Phase 2, even if Phase 1 exposes the existing radio-entry timeout.

## Deferred work

Browser entry reliability, persistent application recovery/attention queues,
larger context-dependent answer-bank redesign, collision-safe question-key
migration, résumé routing/tailoring, outcome analytics, and additional sources
remain outside this phase. The score ranks only the bounded scan. Legacy mode
keeps its streaming order; enabled mode deliberately gathers before applying.

## Planning review record

Self-review checked specification coverage, step clarity, shared interfaces,
the five review inputs and their owning tests, and plan length. The two
workstream plans define eight independently testable tasks; the parent owns
baseline verification, integration, delivery, and the required phase stop.
Documentation checks do not verify implementation. Product code and the new
behavior tests have not been written at this planning stage.
