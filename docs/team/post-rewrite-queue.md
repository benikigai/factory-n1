# Post-rewrite queue

Ben lifted the GitHub push hold on October 17, 2026 after reporting that the author-email rewrite had landed at 13:52 PT. The observed rewritten remote tip was `5ca5655`.

## Completed re-sync

The working tree was clean. Ran `git fetch origin`, then the explicitly requested old-tip form:

```sh
git rebase --onto origin/codex/final-site eb25618 codex/final-site
```

The rebase completed without conflicts. `git log --oneline origin/codex/final-site..HEAD` contained only `b4fc893 Record push hold and queue hero video presentation fixes`, the replay of local commit `2563063`. A normal push advanced the remote from `5ca5655` to `b4fc893`. No force push was used. All ten remapped work-log commit links resolve locally.

## Completed UI changes after the go

- Station labels are hidden only in the landing page's small 3D hero. Browser verification found 0 of 15 labels visible there and all 15 visible in the full replay viewer.
- The landing hero accepts `?speed=60` for the video's opening shot. Absent, invalid, or nonpositive speeds retain the 16x default. Browser verification showed the 60x clock; playback remains tied to recorded traces.
- Goal-compiler evidence remains unchanged: the fixes passed offline tests but have not been verified in a successful live round.

The planning session reported independent 63/63 tests, a clean typecheck, and no console errors at port 5190. This is a reported review result, separate from Codex's verification. After the UI changes, Codex reran all 63 tests, both TypeScript checks, and the static build successfully; the port 5190 preview had no browser-console errors.
