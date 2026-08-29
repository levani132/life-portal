# Specification Quality Checklist: Onboarding and re-baselining

**Purpose**: Validate specification completeness and quality before planning
**Created**: 2026-08-29
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**Status: draft, not scheduled.** Written ahead of time on purpose — one decision inside it changes
a feature already being built, and it was cheaper to surface that now than to discover it later.

### The reason this was written early

FR-011 makes **the day a financial month begins** a setting. `002-spending-waterfall` defines its
monthly tier as "the calendar month of the spending day", which is only right when a financial month
starts on the 1st. The owner's salary lands on the 7th and every monthly budget line is dated the
7th, so a 7th→6th financial month is at least plausible — and if it is real, the waterfall is
computing the wrong window.

**Recommended action, cheap and reversible**: 002 takes `monthStartsOn` now, defaulting to 1. That
default reproduces today's behaviour exactly, so nothing is blocked and nothing needs rewriting when
003 is eventually built. Left until later, the same change means revisiting the waterfall, its tests
and any data already attributed by it.

### Two open questions, neither blocking

1. **Financial month on payday or on the 1st?** Answerable whenever; the safe default holds the door
   open.
2. **Wizard or dashboard checklist?** A wizard suits a first-time setup; a checklist suits
   re-baselining, which is the case that recurs over an account's life. Worth deciding at plan time
   rather than now.

### Scope deliberately kept out

- Opening registration beyond the invite code.
- Importing history from a bank or a spreadsheet.
- Anything to do with widgets a new person need not care about on day one — stocks, ESPP, boards,
  nutrition. They stay discoverable rather than being pushed into the first five minutes.

### What made this spec unusual

Onboarding is normally a new-user concern. Here the **more valuable audience is the existing owner**,
whose balance was entered once months ago and has drifted far from reality — the projection is
anchored to that figure, so a stale anchor quietly corrupts every number downstream. That is why
re-baselining is User Story 2 rather than an afterthought, and why "setup" is modelled as a state
that can be complete-but-stale rather than an event that happens once.
