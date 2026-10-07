# Measuring success of the model and product

## 1. North-star metric

**Verified useful developer outcomes per developer-hour**, constrained by safety and cost.

Examples of an outcome:

- A documentation suggestion is correct, grounded and usable for the stated version.
- A patch resolves the assigned issue without new regression and remains within scope.
- A well-founded abstention identifies missing information and avoids a misleading answer.

Do not combine these into one opaque number. Report documentation usefulness, issue resolution and appropriate abstention separately.

## 2. Balanced scorecard

| Area | Measure | Why |
|---|---|---|
| Correctness | Verified usefulness/resolution, regressions, API-version errors | Checks actual output, not fluent text |
| Grounding | Claim support, citation validity/completeness, answer coverage | Detects hallucination and refusal gaming |
| Safety | Confirmed leaks/unauthorized actions, boundary tests | Non-negotiable deployment condition |
| Developer value | Completion time, repair effort, retained suggestions | Measures useful assistance |
| Economics | Cost per verified outcome, monthly total cost | Includes failures and operations |
| Reliability | Availability, latency, errors, cancellation | Product usability |
| Adoption | Opt-in active users and repeat usage by task class | Adoption is supportive, not proof of correctness |
| Maintainability | Update effort, source freshness, regression recovery time | Long-term sustainability |

Model-level progress must show held-out behavioral/quality gains. Product-level progress may come from better retrieval, tools or UX without any model training.

## 3. Initial proposed gates

These values are targets to validate, not existing results.

| Stage | Quality gate | Additional condition |
|---|---|---|
| Documentation MVP | >=80% verified usefulness over eligible documentation tasks; >=95% supported cited claims; >=99% citation validity | Report completeness/coverage, >=95% correct missing/conflict handling, zero safety violations |
| Repository pilot | >=60% verified resolution of small internal issues | No >2-point regression from baseline; source/patch/validation evidence present |
| Team pilot | Target >=20% median reduction in completion time | Matched/control measurement; no increase in repair effort or defects |
| Optimization release | Target >=15% reduction in cost per verified success | Maintain quality within predefined noninferiority margin and pass safety gates |
| Training experiment | Meaningful held-out gain on the targeted behavior | Same-budget baseline comparison, uncertainty, no safety/general-task regression |

Compare confidence intervals and task slices; do not promote a candidate just because a small sample point estimate crosses a threshold. A proposed 2-point noninferiority margin requires enough data to test; if uncertainty is too wide, gather more evidence.

## 4. How to measure developer productivity

1. Recruit an opt-in pilot of approximately 5-20 developers; this is a usability/economics pilot, not automatically a statistically powered trial.
2. Define representative task strata before the study: docs lookup, examples, small bug fixes, tests and refactors.
3. Measure a baseline using current tools.
4. Randomize comparable tasks or use crossover assignment; counterbalance order to reduce learning effects.
5. Track time to verified completion, review/repair time, outcome quality and confidence.
6. Control for task difficulty, developer experience, environment failure and prior familiarity.
7. Use blinded quality review where possible and report exclusions.
8. Analyze paired results and uncertainty; avoid estimating time saved solely from a survey.

No covert employee monitoring. Users can opt out; use consented aggregates and minimize personal data.

## 5. Suggestion acceptance is not enough

- Acceptance rate: accepted suggestions / shown suggestions.
- Retention rate: accepted suggestions still present after the agreed observation period / accepted suggestions eligible for observation.
- Repair effort: review/fix minutes or changed lines after acceptance.
- Defect rate: regressions attributed after review per completed task.

Define an observation window, for example 7 days for retained patches. Exclude unobservable outcomes explicitly rather than treating them as successes. Acceptance without correctness is a vanity metric.

## 6. Financial success

```text
estimated monthly value
  = verified developer-hours saved * agreed loaded hourly cost

monthly net value
  = estimated value - serving - infrastructure - annotation
                    - operations - amortized development/training costs
```

Use ranges; "hours saved" must reflect repair/review effort. Do not claim ROI from token counts or assumed developer salaries.

Set an approved budget cap during phase 0. Compare local/hosted alternatives with [cost-capacity.md](cost-capacity.md), including idle GPU cost and operational labor.

## 7. Decision rules

- **Promote:** predefined quality/safety/latency/cost gates pass with adequate evidence.
- **Iterate:** useful outcomes improve but remaining retrieval, UX or behavior gaps are understood and bounded.
- **Narrow scope:** strong performance in a subset but broad reliability is weak.
- **Reject training:** adapters do not outperform improved RAG/tools sufficiently.
- **Stop rollout:** any confirmed privacy/permission violation, unacceptable regression, or unmanageable costs.

Publish what changed, what was measured, and what remains unproven. See [benchmarks.md](benchmarks.md) for formulas and [monitoring.md](monitoring.md) for ongoing checks.
