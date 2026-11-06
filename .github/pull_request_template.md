<!-- Thank you. CONTRIBUTING.md has the rules a change has to keep. -->

## What changed

<!-- One or two sentences. Commit messages follow type(scope): summary, for example
     fix(adapters): read a version document served as text/plain -->

## What I examined, and what I did not

<!-- In the same spirit as a verdict: say what you checked, and name what you did not, so a
     reviewer knows where to look. "Not examined: Windows" is a useful line. -->

- Examined:
- Not examined:

## The mutation I tried

<!-- For a behaviour change: put the defect back, confirm that the suite turns red, and restore
     the file. Paste the mutation and name the test that caught it. Write "none" for a change
     with no behaviour, such as docs. -->

```diff

```

Caught by:

## Checklist

- [ ] `npm test` passes
- [ ] The claims lint passes: `node scripts/claims.mjs`
- [ ] No new runtime dependency (or an issue about it was opened first)
- [ ] A behaviour change comes with a test that fails without it

By opening this pull request, I agree that my contribution is licensed under the Apache License, Version 2.0.
