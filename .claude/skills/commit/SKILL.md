---
name: commit
description: Verify, then commit the current Pastel City changes (and push to github.com/acca90/gtak when asked). Runs the smoke check, re-exports art if sources changed, keeps refs/ and generated junk out, and writes a message in the repo's style.
user-invocable: true
disable-model-invocation: true
argument-hint: "[push] [what this change is about]"
allowed-tools:
  - Read
  - Bash(git status*)
  - Bash(git diff*)
  - Bash(git log*)
  - Bash(git add*)
  - Bash(git commit*)
  - Bash(git push*)
  - Bash(git config --get*)
  - Bash(git rev-parse*)
  - Bash(node tools/check.js)
  - Bash(tools/shot.sh*)
  - Bash(tools/art.sh)
---

# /commit — verify and commit Pastel City

Arguments: `$ARGUMENTS`. If they contain `push`, push after committing. Any other text is a
hint about what the change is for; use it in the message.

Work through the steps in order. If a step fails, **stop and report**. Don't commit something
broken to get the job done.

## 1. See what changed

```sh
git status --short
git diff --stat HEAD
git log --oneline -5
```

If nothing changed, say so and stop. Read enough of the diff to describe it accurately. Don't
write the message from memory of the session alone.

## 2. Keep the tree clean

Never stage:
- anything under `refs/` (third-party reference images; it's gitignored, so never force-add it)
- screenshots or scratch files (`*.png` outside `assets/`, `out.png`, `/tmp` copies), editor files
- secrets or tokens of any kind

If you find unexpected untracked files, list them and ask before including them.

## 3. Keep generated art in sync

If anything under `art/`, `tools/generate-art.lua` or `tools/export-art.lua` changed, run:

```sh
tools/art.sh
```

This re-exports `assets/*.png` and `assets/atlas.js`, and the results must go in the same
commit. Never run `tools/art.sh regenerate` here, because it would overwrite hand edits in
`art/*.aseprite`.

`assets/` changed but `art/` didn't? Then someone edited generated files by hand. Stop and
ask.

## 4. Verify

```sh
node tools/check.js
```

It must print `ok`. If `src/`, `index.html` or `assets/` changed, also take at least one
screenshot of a scenario that exercises the change and **look at it** (errors appear on the page):

```sh
tools/shot.sh /tmp/commit-check.png 'demo&drive=60'
```

Choose the hash to fit the change: `demo&at=bx,by&look=tx,ty` frames a block, `time=2` is night,
`mission=...`, `tank=0.5`, `phone=gps`. For art changes: `tools/shot.sh /tmp/g.png '' gallery.html`.
Mention in the report what you looked at.

If controls, features or file layout changed, check that `README.md`, `CLAUDE.md` and
`.claude/rules/` still match. Fix small drift in the same commit; ask about big rewrites.

## 5. Commit

Stage paths explicitly (`git add src/ assets/ art/ ...`) rather than using a blanket `git add -A`,
then check `git status --short` again.

Message style, matching the existing history:
- Subject: imperative, at most 72 characters, says what the game gained or what was fixed
  (e.g. `Add freight train to the Ironworks railway`).
- Blank line, then a short body: bullets for the notable changes and *why*, plus anything
  deliberately left out or not play-tested.
- End with the `Co-Authored-By` trailer from this session's attribution instructions.

Pass the message with a heredoc (`git commit -F - <<'EOF' ... EOF`) so quotes and newlines
come through intact.

## 6. Push (only if asked)

Push only when `$ARGUMENTS` contains `push` or the user asked for it in this conversation.

```sh
git config --get core.sshCommand   # must use ~/.ssh/id_rsa-th-circle (the acca90 account)
git push origin main
```

If `core.sshCommand` isn't set, or the push says `Permission denied`, **don't** try other
keys or accounts. Report it and show the fix from `.claude/rules/git.md`.
Never force-push.

## 7. Report

One short block: commit hash + subject, the files touched (grouped), what verification ran
(check result, which screenshots), and whether it was pushed.
