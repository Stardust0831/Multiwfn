"""Exercise actual shell dispatch, working directories and exit status; no chemistry."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def check(runner):
    runner = Path(runner).resolve()
    with tempfile.TemporaryDirectory(prefix="workflow shell 中文 ") as directory:
        work = Path(directory)
        rc = work / "banewfn.rc"
        base_rc = 'Multiwfn_exec=unused\ncores=1\ncitations_output=off\n'
        rc.write_text(base_rc, encoding="utf-8")
        source = work / "shell.bw"
        environment = os.environ.copy()
        environment.pop("BANEWFN_GIT_BASH", None)

        def run(body, env=None, success=True):
            # Check CRLF input from a Windows editor, including a blank first line.
            source.write_bytes(("%command\n" + body + "\nend\n").replace("\n", "\r\n").encode("utf-8"))
            result = subprocess.run(
                [str(runner), str(source)], cwd=work, env=env or environment,
                stdin=subprocess.DEVNULL, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=30,
            )
            log = result.stdout + result.stderr
            assert (result.returncode == 0) == success, log
            return log

        body = '''
#!/bin/bash
[[ -n "$BASH_VERSION" ]] || exit 21
values=(alpha beta)
mkdir -p 'output folder'
printf '%s' "${values[1]}" > 'output folder/source.txt'
mv 'output folder/source.txt' 'output folder/result.txt'
'''
        log = run(body)
        assert (work / "output folder/result.txt").read_text() == "beta", log
        if os.name == "nt":
            assert "Running script with Git Bash:" in log, log
            bash = log.split("Running script with Git Bash: ", 1)[1].split(" --noprofile", 1)[0]
            assert Path(bash).is_file(), log
            custom = dict(environment, BANEWFN_GIT_BASH=bash)
            run('#!/usr/bin/env bash\n[[ -n "$BASH_VERSION" ]]', custom)
            # Accept a legacy git-bash.exe setting without launching a terminal.
            launcher = Path(bash).parent.parent / "git-bash.exe"
            rc.write_text(base_rc + f'gitbash_exec="{launcher.as_posix()}"\n', encoding="utf-8")
            run('#!/bin/bash\nexit 0', dict(custom, BANEWFN_GIT_BASH="X:/missing/bash.exe"))
            rc.write_text(base_rc, encoding="utf-8")
            failure = run('#!/bin/bash\necho wrong > wrong-shell.txt',
                          dict(custom, BANEWFN_GIT_BASH="X:/missing/bash.exe"), success=False)
            assert "Git Bash was not found" in failure, failure
            assert not (work / "wrong-shell.txt").exists()
            # A bare bash.exe on PATH (including WSL's shim) is not Git discovery.
            missing = dict(environment, PATH=os.environ.get("SystemRoot", "C:/Windows") + "/System32")
            for key in ("ProgramW6432", "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
                missing[key.upper()] = ""
            failure = run('#!/bin/bash\nexit 0', missing, success=False)
            assert "Git Bash was not found" in failure, failure
            # Portable Git installations exposed only through PATH also work.
            missing["PATH"] = str(Path(bash).parent.parent / "cmd") + ";" + missing["PATH"]
            run('#!/bin/bash\n[[ -n "$BASH_VERSION" ]]', missing)
            log = run('@echo off\necho cmd-ok>cmd-result.txt')
            assert "Running script with Git Bash:" not in log, log
            assert (work / "cmd-result.txt").read_text().strip() == "cmd-ok", log
            failure = run('#!/bin/bash\nexit 7', success=False)
            assert "error code 7" in failure, failure
        else:
            run('#!/bin/bash\nexit 7', success=False)
    print(f"Workflow shell dispatch passed: {runner}")


if __name__ == "__main__":
    check(Path(sys.argv[1]))
