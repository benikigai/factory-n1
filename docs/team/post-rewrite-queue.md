# Post-rewrite queue

Ben requested a GitHub push hold on October 17, 2026 while commit author emails are rewritten. Do not push, fetch, or rebase until Ben gives the go. Local work and commits are allowed.

After the go:

1. Commit or stash any uncommitted work.
2. Run `git fetch origin`.
3. Run `git pull --rebase origin codex/final-site`.
4. Stop and report if the rebase conflicts.
5. Check `git log --oneline origin/codex/final-site..HEAD` contains only our new local commits.
6. Push normally. Never force-push. PR #1 updates from this branch.

## UI changes to implement after the go

- Hide station labels only in the landing page's small 3D hero. Preserve them in the full replay viewer.
- Accept a landing hero speed override such as `?speed=60` for the video's opening shot. Keep the replay tied to recorded traces.
- Keep the goal-compiler evidence explicit: the fixes passed offline tests but have not been verified in a successful live round.

The planning session reported independent 63/63 tests, a clean typecheck, and no console errors at port 5190. This is a reported review result, separate from Codex's prior local verification.
