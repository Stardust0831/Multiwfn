#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
smoke_dir="$repo_dir/.build-env/gnu-smoke-stderr-audit-smoke.$$"
allowed_stderr='Note: The following floating-point exceptions are signalling: IEEE_INVALID_FLAG'

cleanup() {
    status=$?
    if [ "$status" -eq 0 ]; then
        rm -rf "$smoke_dir"
    else
        printf '%s\n' "GNU smoke stderr audit smoke output kept at: $smoke_dir"
    fi
}
trap cleanup EXIT

mkdir -p "$smoke_dir/pass/nested" "$smoke_dir/fail"

: > "$smoke_dir/pass/empty.err"
printf '%s\n' "$allowed_stderr" > "$smoke_dir/pass/known.err"
printf '%s\n%s\n' "$allowed_stderr" "$allowed_stderr" > "$smoke_dir/pass/nested/repeated-known.err"

pass_out="$smoke_dir/pass.out"
"$script_dir/audit-gnu-smoke-stderr.sh" "$smoke_dir/pass" > "$pass_out"
grep -Fq "EMPTY   empty.err" "$pass_out"
grep -Fq "KNOWN   known.err" "$pass_out"
grep -Fq "KNOWN   nested/repeated-known.err" "$pass_out"
grep -Fq "empty stderr files: 1" "$pass_out"
grep -Fq "known IEEE_INVALID_FLAG stderr files: 2" "$pass_out"
grep -Fq "unexpected stderr files: 0" "$pass_out"

printf '%s\n' "unexpected stderr" > "$smoke_dir/fail/bad.err"
fail_out="$smoke_dir/fail.out"
if "$script_dir/audit-gnu-smoke-stderr.sh" "$smoke_dir/fail" > "$fail_out" 2>&1; then
    printf '%s\n' "Expected audit-gnu-smoke-stderr to fail for unexpected stderr."
    exit 1
fi
grep -Fq "BAD     bad.err" "$fail_out"
grep -Fq "unexpected stderr files: 1" "$fail_out"

missing_out="$smoke_dir/missing.out"
if "$script_dir/audit-gnu-smoke-stderr.sh" "$smoke_dir/missing" > "$missing_out" 2>&1; then
    printf '%s\n' "Expected audit-gnu-smoke-stderr to fail for a missing smoke directory."
    exit 1
fi
grep -Fq "GNU noGUI smoke stderr directory was not found: $smoke_dir/missing" "$missing_out"

printf '%s\n' "GNU smoke stderr audit smoke test passed."
