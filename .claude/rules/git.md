# Git

- Remote: `github.com/acca90/gtak`, branch `main`. Commit with the `/commit` skill. Push only
  when the user asks.
- The machine's default SSH key is another GitHub account without write access. This clone sets
  `core.sshCommand` to use `~/.ssh/id_rsa-th-circle` (account acca90). A fresh clone needs:
  `git config core.sshCommand "ssh -i ~/.ssh/id_rsa-th-circle -o IdentitiesOnly=yes"`.
- `refs/` holds third-party reference images and is gitignored on purpose. Don't commit it.
- Commit `.claude/` (agents, skills, rules, agent-memory). It's part of the project.
