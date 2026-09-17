# Kickoff prompt for Claude Code (web)

Connect Claude Code on the web to `mfaisalshakeel/qoutexclone` on the branch
`claude/gallant-heisenberg-y38t6b` and paste the prompt below. If a session ends before the
roadmap is done, open a new session and paste the same prompt. It resumes from the first
unticked box.

---

```
You are building Quantex into a production-grade binary options platform at Quotex's level.

1. Read CLAUDE.md, docs/ROADMAP.md and docs/PROGRESS.md completely before doing anything.
2. Set up the environment: install and start MariaDB, create the database, npm install,
   migrate, seed, and make sure typecheck, tests and build pass on the current code.
3. Work through docs/ROADMAP.md strictly in order, starting at the first unticked box.
   For each task: build it fully (backend, API, UI, all states, mobile, tests), verify it
   against the Definition of done in CLAUDE.md, including running it in a real browser,
   tick the box, log it in docs/PROGRESS.md, commit and push.
4. Do not stop after a task, do not ask me whether to continue, and do not summarise and
   wait. Keep going to the next task until every box in the roadmap is ticked. If a
   decision is unclear, choose what Quotex does, make it configurable, write it under
   Decisions in PROGRESS.md and continue. Stop only for things listed under
   "Blocked on owner", and even then continue with every other task.
5. Never tick a box that isn't verified. Never leave stubs, TODOs or fake data presented
   as finished. If something breaks, fix it before moving on.
6. Respect the invariants in CLAUDE.md, especially: money in integer cents through
   applyLedger, idempotent settlement, and prices that never depend on traders' positions.

Start now with Phase 0.
```
