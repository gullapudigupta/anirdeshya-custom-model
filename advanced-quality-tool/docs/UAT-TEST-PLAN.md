# User Acceptance Test Plan

UAT remains pending until a beta build is authorized, external testers are
recruited, and feedback is reviewed with the maintainer. This plan prepares the
repository work; it is not evidence that UAT has been run.

## Entry criteria

- A maintainer has approved the beta build and provided access instructions.
- Testers use a disposable sample repository and do not submit confidential
  source code or credentials.
- Record the AQT commit, operating system, Node.js version, and enabled external
  analyzer tools for each run.
- Complete the automated test suite before distributing the beta.

## Scenarios

| ID | Scenario | Expected result |
| --- | --- | --- |
| UAT-01 | Install AQT using the documented clean-install steps on a supported Node.js version | Installation succeeds without editing the lockfile; the CLI help is available |
| UAT-02 | Analyze a sample JavaScript/TypeScript project containing known issues | Reported files, rules, and locations match the sample; no unrelated files are modified |
| UAT-03 | Run a configured external-language analyzer against a sample project | Diagnostics map to the correct file and source location; tool failures are visible and are not accepted as a clean result |
| UAT-04 | Generate code from a prompt that yields only a scaffold or no usable output | The result is reported as incomplete/unsuccessful, not as a completed implementation |
| UAT-05 | Review pipeline and agent execution history, then open an execution detail | Lists and detail views show the API-returned data and useful failure states |
| UAT-06 | Request replay from the UI/API | The response is clearly a preview and does not claim that a new execution occurred |
| UAT-07 | Export an execution summary | Export contains only the documented allowlisted fields and opens as valid JSON |
| UAT-08 | Exercise security scanning and URL validation with safe and rejected inputs | Rejected inputs are blocked with a clear explanation; accepted scans produce an understandable result |
| UAT-09 | Verify analytics settings and inspect captured events | Collection stays disabled unless the user explicitly opts in; captured data follows the documented local-only behavior |
| UAT-10 | Repeat core workflows on the tester's target operating systems | Behavior is consistent, with any platform-specific issue recorded against the exact environment |

## Feedback and acceptance

For every issue, capture the scenario ID, expected and actual behavior, AQT
commit, environment, reproduction steps, impact, and a sanitized screenshot or
log excerpt. Do not attach secrets or proprietary source.

The maintainer should classify each report, assign an owner, and record a
resolution or accepted limitation. UAT sign-off requires no unresolved critical
or high-impact blockers, verification of fixes by testers, and explicit
maintainer approval. Record the sign-off and any accepted risks in the release
record before production preparation.
