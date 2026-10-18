#!/bin/sh
# Tests for tools/mirror-spec.sh. Each case builds two throwaway git checkouts:
# a source laid out like this repo, with a copy of the script in its tools/,
# and a target laid out like a cashu-javacard checkout, with files beside spec/
# that must come through untouched. The source's history is the target's spec/
# (the last mirror), then a spec PR, merged: origin/main is at it. Needs git,
# diff and tar; no network. CI runs it on every push and pull request:
#
#   sh tools/mirror-spec.test.sh
#
# One TAP line a check; exits 1 when any check fails, and at once when the
# script is missing or not executable.
set -u

# Git with none of the caller's configuration (identity, hooks, signing, global
# ignores) and none of a hook's environment, so a check means the same on a
# laptop and in CI; and no CDPATH, which would send the cd of a relative path
# elsewhere or have it print into $here.
unset CDPATH GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
GIT_CONFIG_GLOBAL=/dev/null
GIT_CONFIG_NOSYSTEM=1
GIT_AUTHOR_NAME=mirror-spec.test
GIT_AUTHOR_EMAIL=mirror-spec.test@example.invalid
GIT_COMMITTER_NAME=$GIT_AUTHOR_NAME
GIT_COMMITTER_EMAIL=$GIT_AUTHOR_EMAIL
export GIT_CONFIG_GLOBAL GIT_CONFIG_NOSYSTEM GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL

here=$(cd "$(dirname "$0")" && pwd -P)
script=$here/mirror-spec.sh

tmp=$(mktemp -d "${TMPDIR:-/tmp}/mirror-spec-test.XXXXXX") || exit 1
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' HUP INT TERM
: >"$tmp/out"
: >"$tmp/err"
rc=-

n=0
failed=0
pass() {
	n=$((n + 1))
	echo "ok $n - $1"
}
fail() {
	n=$((n + 1))
	failed=$((failed + 1))
	echo "not ok $n - $1"
	echo "#   exit $rc"
	sed 's/^/#   out: /' "$tmp/out"
	sed 's/^/#   err: /' "$tmp/err"
}
# verdict <what>: a TAP line for the exit status of the command just before it.
verdict() {
	if [ $? -eq 0 ]; then pass "$1"; else fail "$1"; fi
}

[ -f "$script" ] && [ -x "$script" ]
verdict "tools/mirror-spec.sh exists and is executable"
if [ "$failed" -ne 0 ]; then
	echo "1..$n"
	exit 1
fi

# put <file> <line>: write a one-line file, and its directory.
put() {
	mkdir -p "$(dirname "$1")" && printf '%s\n' "$2" >"$1"
}

commit() {
	git -C "$1" add -A && git -C "$1" commit -q -m "$2"
}

# merged <checkout>: its origin/main moves to its HEAD, as when the PR has
# merged and been fetched.
merged() {
	git -C "$1" update-ref refs/remotes/origin/main HEAD
}

# Every file under $1 but .git, with its checksum: the same before and after
# means nothing there changed.
snapshot() {
	(cd "$1" && find . -name .git -prune -o -type f -exec cksum {} + | sort)
}

# Under spec/, nothing else.
outside() {
	snapshot "$1" | grep -v ' \./spec/'
}

# last <checkout>: spec/ as the last mirror left it, which the target holds.
last() {
	put "$1/spec/APDU.md" "wire 2.0"
	put "$1/spec/NUT-XX.md" "the protocol"
	put "$1/spec/vectors/owner.json" '{"owner": 1}'
	put "$1/spec/OLD.md" "only there"
	put "$1/spec/old/GONE.md" "a directory only there"
}

# fresh: a new source ($src, its copy of the script $s) and target ($dst),
# each committed. The source's first commit has the spec/ the target holds;
# its second, a spec PR merged into origin/main, is HEAD.
k=0
fresh() {
	k=$((k + 1))
	src=$tmp/$k/cashu-card
	dst=$tmp/$k/cashu-javacard
	s=$src/tools/mirror-spec.sh
	mkdir -p "$src/tools" "$dst"
	git -c init.defaultBranch=main init -q "$src"
	git -c init.defaultBranch=main init -q "$dst"
	cp "$script" "$s" && chmod +x "$s"
	put "$src/README.md" "the working repo"
	last "$src"
	commit "$src" "spec/ as the last mirror left it"
	put "$src/spec/APDU.md" "wire 2.1"
	put "$src/spec/vectors/transcript.json" '{"only": "here"}'
	put "$src/spec/notes/NEW.md" "a directory only here"
	rm -r "$src/spec/OLD.md" "$src/spec/old"
	commit "$src" "a spec PR"
	merged "$src"
	put "$dst/README.md" "the protocol reference"
	last "$dst"
	put "$dst/spec.md" "beside spec/, not in it"
	put "$dst/specs/KEEP.md" "beside spec/, not in it"
	put "$dst/tools/keep.sh" "outside spec/"
	commit "$dst" target
}

# run <args>: the source's copy of the script; its exit code in $rc.
run() {
	"$s" "$@" >"$tmp/out" 2>"$tmp/err"
	rc=$?
}

# --- the arguments ------------------------------------------------------------
fresh
before=$(snapshot "$dst")
run
[ "$rc" -eq 2 ] && grep -q "^usage: " "$tmp/err"
verdict "no target: exit 2 and the usage"
run --help
[ "$rc" -eq 0 ] && grep -q "^usage: " "$tmp/out"
verdict "--help: exit 0 and the usage"
run "$dst" --force
[ "$rc" -eq 2 ] && grep -q -e "--force" "$tmp/err"
verdict "an unknown option: exit 2"
run "$dst" "$dst"
[ "$rc" -eq 2 ]
verdict "two targets: exit 2"
run "$tmp/nowhere" --apply
[ "$rc" -eq 2 ] && [ ! -e "$tmp/nowhere" ]
verdict "a target that does not exist: exit 2"
put "$tmp/plain/spec/APDU.md" "not a checkout"
run "$tmp/plain" --apply
[ "$rc" -eq 2 ] && [ "$(cat "$tmp/plain/spec/APDU.md")" = "not a checkout" ] && [ ! -e "$tmp/plain/spec/NUT-XX.md" ]
verdict "a directory that is not a checkout: exit 2, its spec/ as it was"
run "$dst/spec" --apply
[ "$rc" -eq 2 ] && [ ! -e "$dst/spec/spec" ]
verdict "a directory inside a checkout (the target's own spec/): exit 2"
run "$src" --apply
[ "$rc" -eq 2 ]
verdict "this repo as the target: exit 2"
[ "$(snapshot "$dst")" = "$before" ]
verdict "none of those touched the target"

fresh
git -C "$dst" rm -r -q spec
put "$tmp/elsewhere/APDU.md" "outside the target"
ln -s "$tmp/elsewhere" "$dst/spec"
commit "$dst" "spec is a link"
run "$dst" --apply
[ "$rc" -eq 2 ] && [ -L "$dst/spec" ] && [ "$(cat "$tmp/elsewhere/APDU.md")" = "outside the target" ] && [ -z "$(git -C "$dst" status --porcelain)" ]
verdict "a target whose spec/ is a committed symbolic link: exit 2, the link and what it names as they were"

fresh
git -C "$dst" rm -r -q spec
put "$dst/spec" "a file named spec"
commit "$dst" "spec is a file"
run "$dst" --apply
[ "$rc" -eq 2 ] && grep -q "spec is not a directory" "$tmp/err" && [ -f "$dst/spec" ] && [ "$(cat "$dst/spec")" = "a file named spec" ] && [ -z "$(git -C "$dst" status --porcelain)" ]
verdict "a target whose spec is a committed regular file: exit 2, the file as it was"

# --- dry run, apply, dry run --------------------------------------------------
fresh
before=$(snapshot "$dst")
run "$dst"
[ "$rc" -eq 1 ]
verdict "dry run, spec/ differs: exit 1"
grep -qF "at $(git -C "$src" rev-parse --short HEAD) (main)" "$tmp/err" &&
	grep -q "^  Files a/spec/APDU.md and b/spec/APDU.md differ" "$tmp/err" && grep -q "^  Only in a/spec: OLD.md" "$tmp/err" &&
	grep -q -e "--apply copies it" "$tmp/err"
verdict "dry run: names the commit and its branch, lists what differs, and says --apply copies it"
grep -q "^--- a/spec/APDU.md" "$tmp/out" && grep -q "^+++ b/spec/APDU.md" "$tmp/out" &&
	grep -q "^-wire 2.0" "$tmp/out" && grep -q "^+wire 2.1" "$tmp/out"
verdict "dry run: a unified diff, the target's file (a/) against this repo's (b/)"
grep -q '^+{"only": "here"}' "$tmp/out" && grep -q "^+a directory only here" "$tmp/out" &&
	grep -q "^-only there" "$tmp/out" && grep -q "^-a directory only there" "$tmp/out"
verdict "dry run: the files only here are added, the ones only there removed"
! grep -q -e NUT-XX -e owner.json -e README -e spec.md -e specs/ -e keep.sh "$tmp/out"
verdict "dry run: the identical files and everything outside spec/ are not in the diff"
[ "$(snapshot "$dst")" = "$before" ]
verdict "dry run: the target unchanged"

before=$(outside "$dst")
run "$dst" --apply
[ "$rc" -eq 0 ]
verdict "apply: exit 0"
diff -r "$src/spec" "$dst/spec" >/dev/null
verdict "apply: the target's spec/ is the source's, file for file"
[ ! -e "$dst/spec/OLD.md" ] && [ ! -e "$dst/spec/old" ]
verdict "apply: what is only there is removed"
[ "$(outside "$dst")" = "$before" ]
verdict "apply: nothing outside spec/ changed"
[ -n "$(git -C "$dst" status --porcelain)" ] &&
	! git -C "$dst" status --porcelain --untracked-files=all | cut -c4- | grep -qv "^spec/"
verdict "apply: git sees changes under spec/ and nowhere else"
grep -q "^ M spec/APDU.md" "$tmp/out" && grep -q "^ D spec/OLD.md" "$tmp/out" && grep -q "^?? spec/" "$tmp/out"
verdict "apply: prints git -C <target> status --short"
[ -z "$(git -C "$src" status --porcelain --untracked-files=all)" ]
verdict "apply: the source untouched"

run "$dst"
[ "$rc" -eq 2 ]
verdict "dry run on the applied mirror before it is committed: exit 2"
commit "$dst" mirror
run "$dst"
[ "$rc" -eq 0 ] && [ ! -s "$tmp/out" ]
verdict "dry run once the mirror is committed: exit 0, no diff"
[ "$(git -C "$dst" rev-parse HEAD:spec)" = "$(git -C "$src" rev-parse HEAD:spec)" ]
verdict "the committed mirror is the source's spec/, tree for tree"
run "$dst" --apply
[ "$rc" -eq 0 ] && [ -z "$(git -C "$dst" status --porcelain --untracked-files=all)" ]
verdict "apply when identical: exit 0, nothing to commit"

fresh
run --apply "$dst"
[ "$rc" -eq 0 ] && diff -r "$src/spec" "$dst/spec" >/dev/null
verdict "--apply before the target: the same copy"

fresh
git -C "$dst" rm -r -q spec
commit "$dst" "no spec yet"
run "$dst"
[ "$rc" -eq 1 ] && [ ! -e "$dst/spec" ]
verdict "a target with no spec/ yet: dry run exits 1"
run "$dst" --apply
[ "$rc" -eq 0 ] && diff -r "$src/spec" "$dst/spec" >/dev/null
verdict "... and --apply makes it"

# --- a file on one side only differs, an empty one too ------------------------
fresh
run "$dst" --apply
commit "$dst" mirror
mkdir -p "$src/spec/fixtures" && : >"$src/spec/fixtures/.gitkeep"
commit "$src" "an empty file"
merged "$src"
run "$dst"
[ "$rc" -eq 1 ] && grep -q "Only in b/spec: fixtures" "$tmp/err"
verdict "an empty file only in the source: the dry run exits 1 and names it"
run "$dst" --apply
[ "$rc" -eq 0 ] && [ -f "$dst/spec/fixtures/.gitkeep" ] && [ ! -s "$dst/spec/fixtures/.gitkeep" ]
verdict "... and --apply creates it"
commit "$dst" "mirror of the empty file"
[ "$(git -C "$dst" rev-parse HEAD:spec)" = "$(git -C "$src" rev-parse HEAD:spec)" ]
verdict "... and the mirror, committed, is the source's spec/, tree for tree"
git -C "$src" rm -q spec/fixtures/.gitkeep
commit "$src" "the empty file goes"
merged "$src"
run "$dst"
[ "$rc" -eq 1 ] && grep -q "Only in a/spec: fixtures" "$tmp/err"
verdict "an empty file only in the target: the dry run exits 1 and names it"
run "$dst" --apply
[ "$rc" -eq 0 ] && [ ! -e "$dst/spec/fixtures" ]
verdict "... and --apply removes it"

# --- refusals: a HEAD that has not merged, a target ahead of HEAD -------------
fresh
git -C "$src" checkout -q -b pr-b
put "$src/spec/NUT-XX.md" "a change not merged yet"
commit "$src" "an open PR"
before=$(snapshot "$dst")
run "$dst"
[ "$rc" -eq 1 ] && grep -q "^+a change not merged yet" "$tmp/out" &&
	grep -q -e "--apply would refuse" "$tmp/err" && grep -q "is not in origin/main" "$tmp/err"
verdict "HEAD not in origin/main (an open PR's branch): the dry run shows the diff and says --apply would refuse"
run "$dst" --apply
[ "$rc" -eq 2 ] && grep -q "is not in origin/main" "$tmp/err" && grep -qF "(pr-b)" "$tmp/err" && [ "$(snapshot "$dst")" = "$before" ]
verdict "... and --apply exits 2, names the branch, and changes nothing"

fresh
git -C "$src" update-ref -d refs/remotes/origin/main
before=$(snapshot "$dst")
run "$dst" --apply
[ "$rc" -eq 2 ] && grep -q "has no origin/main" "$tmp/err" && [ "$(snapshot "$dst")" = "$before" ]
verdict "no origin/main to tell whether HEAD has merged: --apply exits 2, changing nothing"

# The PR is mirrored; then --apply runs from a worktree of main from before
# it, which is merged and behind the mirror.
fresh
run "$dst" --apply
commit "$dst" "mirror of the PR"
git -C "$src" worktree add -q --detach "$tmp/$k/stale" HEAD~1
s=$tmp/$k/stale/tools/mirror-spec.sh
before=$(snapshot "$dst")
run "$dst"
[ "$rc" -eq 1 ] && grep -q -e "--apply would refuse" "$tmp/err" && grep -q "is not one that spec/ here has been at" "$tmp/err"
verdict "a worktree behind the commit the mirror was made from: the dry run says --apply would refuse"
run "$dst" --apply
[ "$rc" -eq 2 ] && grep -q "is not one that spec/ here has been at" "$tmp/err" && grep -qF "(detached HEAD)" "$tmp/err" &&
	[ "$(snapshot "$dst")" = "$before" ]
verdict "... and --apply exits 2, changing nothing"

fresh
put "$dst/spec/APDU.md" "an edit made in the mirror, and committed there"
commit "$dst" "an edit in the mirror"
before=$(snapshot "$dst")
run "$dst" --apply
[ "$rc" -eq 2 ] && grep -q "is not one that spec/ here has been at" "$tmp/err" && [ "$(snapshot "$dst")" = "$before" ]
verdict "a spec/ committed in the target that this repo never had: --apply exits 2, changing nothing"

fresh
run "$dst" --apply
commit "$dst" "mirror of the PR"
git -C "$src" revert --no-edit HEAD >/dev/null
merged "$src"
run "$dst" --apply
[ "$rc" -eq 0 ] && diff -r "$src/spec" "$dst/spec" >/dev/null && [ "$(cat "$dst/spec/APDU.md")" = "wire 2.0" ]
verdict "a revert merged here is mirrored: forward is HEAD's history, whatever spec/ says"

# --- refusals: uncommitted changes under spec/ --------------------------------
for kind in modified staged untracked ignored; do
	fresh
	case $kind in
	modified)
		put "$dst/spec/APDU.md" "an edit in the mirror"
		path=spec/APDU.md
		;;
	staged)
		put "$dst/spec/APDU.md" "a staged edit in the mirror"
		git -C "$dst" add spec/APDU.md
		path=spec/APDU.md
		;;
	untracked)
		put "$dst/spec/DRAFT.md" "a new file in the mirror"
		path=spec/DRAFT.md
		;;
	ignored)
		put "$dst/.gitignore" "*.swp"
		commit "$dst" ignore
		put "$dst/spec/.APDU.md.swp" "an editor's file"
		path=spec/.APDU.md.swp
		;;
	esac
	before=$(snapshot "$dst")
	run "$dst"
	[ "$rc" -eq 2 ] && grep -qF "$path" "$tmp/err" && [ ! -s "$tmp/out" ]
	verdict "an uncommitted file under the target's spec/ ($kind): the dry run exits 2 and names it"
	run "$dst" --apply
	[ "$rc" -eq 2 ] && grep -qF "$path" "$tmp/err" && [ "$(snapshot "$dst")" = "$before" ]
	verdict "... and --apply exits 2, changing nothing"
done

fresh
put "$dst/README.md" "an edit beside spec/"
run "$dst"
[ "$rc" -eq 1 ]
verdict "an uncommitted change outside the target's spec/ is no refusal: dry run exits 1"
run "$dst" --apply
[ "$rc" -eq 0 ] && diff -r "$src/spec" "$dst/spec" >/dev/null && [ "$(cat "$dst/README.md")" = "an edit beside spec/" ]
verdict "... and --apply copies spec/ and leaves that change as it was"

for kind in modified untracked; do
	fresh
	case $kind in
	modified) path=spec/APDU.md ;;
	untracked) path=spec/DRAFT.md ;;
	esac
	put "$src/$path" "uncommitted, in the source"
	before=$(snapshot "$dst")
	run "$dst" --apply
	[ "$rc" -eq 2 ] && grep -qF "$path" "$tmp/err" && [ "$(snapshot "$dst")" = "$before" ]
	verdict "an uncommitted file under the source's spec/ ($kind): exit 2, names it, the target unchanged"
done

fresh
put "$src/.gitignore" "*.swp"
commit "$src" ignore
merged "$src"
put "$src/spec/.APDU.md.swp" "an editor's file, ignored in the source"
run "$dst" --apply
[ "$rc" -eq 0 ] && [ ! -e "$dst/spec/.APDU.md.swp" ] && [ "$(cat "$dst/spec/APDU.md")" = "wire 2.1" ]
verdict "the copy is spec/ as committed: a file the source ignores is not copied"

# --- the call AGENTS.md gives, relative, under a CDPATH -----------------------
# With . in CDPATH, cd prints the directory it finds, into $root; without it,
# /bin/sh as bash does not look in the current directory at all.
for cdpath in ".:$tmp" "$tmp"; do
	case $cdpath in
	.:*) with="with . first" ;;
	*) with="without ." ;;
	esac
	fresh
	(cd "$tmp/$k" && CDPATH=$cdpath cashu-card/tools/mirror-spec.sh cashu-javacard) >"$tmp/out" 2>"$tmp/err"
	rc=$?
	[ "$rc" -eq 1 ] && grep -q "^--- a/spec/APDU.md" "$tmp/out"
	verdict "a relative call and target, CDPATH set $with: the dry run finds both checkouts, exit 1"
	(cd "$tmp/$k" && CDPATH=$cdpath cashu-card/tools/mirror-spec.sh cashu-javacard --apply) >"$tmp/out" 2>"$tmp/err"
	rc=$?
	[ "$rc" -eq 0 ] && diff -r "$src/spec" "$dst/spec" >/dev/null
	verdict "... and --apply copies"
done

echo "1..$n"
if [ "$failed" -ne 0 ]; then
	echo "# $failed of $n failed"
	exit 1
fi
