"""Run Korean editorial generation from an isolated checkout, without windows.

Only public AI Trend data is committed. Existing source changes stay untouched.
Authentication stays in the user's local CLI stores; credentials are never copied.
"""
from pathlib import Path
import datetime
import os
import subprocess
import sys
import time

REPO = Path(__file__).resolve().parents[3]
STATE = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "PersonalTap" / "ai-trend"
FLAGS = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def main():
    STATE.mkdir(parents=True, exist_ok=True)
    lock = STATE / "research.lock"
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        # Scheduler uses IgnoreNew as well. An abandoned lock expires only after
        # the task's two-hour maximum has passed, with an additional buffer.
        if time.time() - lock.stat().st_mtime < 3 * 3600:
            return 0
        lock.unlink()
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    os.close(fd)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    log_path = STATE / f"research-{stamp}.log"
    work = REPO / ".tmp" / "ai-trend-research" / stamp
    work.parent.mkdir(parents=True, exist_ok=True)
    work_added = False
    # This Desktop checkout was created with an administrator token. The hidden
    # task deliberately runs as the normal user. Trust only these exact, known
    # checkouts for this invocation, without a global safe.directory wildcard.
    git_prefix = ["git", "-c", f"safe.directory={REPO.as_posix()}", "-c", f"safe.directory={work.as_posix()}"]
    try:
        with log_path.open("w", encoding="utf-8") as log:
            def run(args, cwd=REPO, timeout=120, capture=False):
                log.write("RUN " + " ".join(str(a) for a in args[:4]) + "\n")
                log.flush()
                if args[0] == "git":
                    args = git_prefix + args[1:]
                result = subprocess.run(args, cwd=cwd, env={**os.environ, "PYTHONIOENCODING": "utf-8"}, stdout=subprocess.PIPE if capture else log, stderr=log, text=True, encoding="utf-8", timeout=timeout, creationflags=FLAGS)
                if result.returncode:
                    raise RuntimeError(f"Command failed ({result.returncode}); see {log_path}")
                return result.stdout.rstrip("\r\n") if capture else ""

            run(["git", "fetch", "origin", "main"])
            run(["git", "worktree", "add", "--detach", str(work), "origin/main"])
            work_added = True
            # gh's token is provided only to the source collector process, never
            # placed on a command line, in logs, in generated data, or in Git.
            token = run(["gh", "auth", "token"], capture=True).strip()
            child_env = {**os.environ, "GH_TOKEN": token}
            result = subprocess.run(["node", "apps/ai-trend/tools/research.mjs"], cwd=work, env=child_env, stdout=log, stderr=log, timeout=90 * 60, creationflags=FLAGS)
            if result.returncode:
                raise RuntimeError(f"Research failed ({result.returncode})")
            run(["node", "--test", "apps/ai-trend/tests/collector.test.mjs", "apps/ai-trend/tests/editorial.test.mjs", "apps/ai-trend/tests/selection.test.mjs"], cwd=work)
            # Audit the allowed changes before staging anything.
            changed = run(["git", "status", "--porcelain", "--untracked-files=all"], cwd=work, capture=True)
            for line in changed.splitlines():
                target = line[3:].strip('"')
                if not target.startswith("apps/ai-trend/data/"):
                    raise RuntimeError("Unexpected generated change; publication refused")
            run(["git", "add", "--", "apps/ai-trend/data"], cwd=work)
            staged = run(["git", "diff", "--cached", "--name-only"], cwd=work, capture=True)
            if staged:
                run(["git", "commit", "-m", "chore: refresh Korean AI Trend research"], cwd=work)
                # Rebase handles nonoverlapping source updates. Conflicting
                # generated editions are preserved in this checkout for review.
                run(["git", "pull", "--rebase", "origin", "main"], cwd=work)
                run(["git", "push", "origin", "HEAD:main"], cwd=work)
                # Explicit dispatch also works when publication credentials are
                # a bot token and its push does not trigger another workflow.
                run(["gh", "workflow", "run", "deploy-pages.yml", "--ref", "main", "--repo", "Yuni9959/Personal"], cwd=work)
            log.write("SUCCESS: Korean edition validated and publication completed\n")
        run_cleanup = subprocess.run(git_prefix + ["worktree", "remove", str(work)], cwd=REPO, capture_output=True, creationflags=FLAGS)
        if run_cleanup.returncode:
            return 1
        for old in sorted(STATE.glob("research-*.log"), reverse=True)[30:]:
            old.unlink()
        return 0
    except Exception as error:
        with log_path.open("a", encoding="utf-8") as log:
            log.write(f"FAILED: {error}\n")
            if work_added:
                log.write(f"Preserved checkout for recovery: {work}\n")
        return 1
    finally:
        lock.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
