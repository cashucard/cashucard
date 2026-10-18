#!/bin/sh
# Mirror this repo's spec/ into a checkout of lnflash/cashu-javacard, the
# protocol reference, which takes no spec edits of its own (AGENTS.md). Run it
# from main once a PR that touches spec/ has merged here, after a pull:
#
#   tools/mirror-spec.sh <path-to-cashu-javacard-checkout>           dry run
#   tools/mirror-spec.sh <path-to-cashu-javacard-checkout> --apply   copy
#
# The dry run prints a unified diff of spec/, the target's (a/) against this
# repo's (b/), and exits 0 when they are identical and 1 when they differ. A
# file on one side only is a difference, an empty one too; the patch cannot
# show an empty file, so the dry run also lists on stderr what differs.
# --apply makes the target's spec/ this repo's, removing what is no longer
# here, then prints `git -C <target> status --short`; committing and pushing
# there are the operator's. What is copied is spec/ as committed at this repo's
# HEAD, and nothing outside spec/ is touched on either side.
#
# --apply copies a HEAD that has merged, and moves the mirror forward only: it
# exits 2, with nothing changed, unless HEAD is in the history of origin/main
# (as last fetched; there is no fetch here), and unless the spec/ the target
# has committed is one that spec/ here has been at in HEAD's history. So an
# unmerged branch cannot publish its spec/, and a worktree behind the commit
# the mirror was made from cannot take the mirror back. The dry run says when
# --apply would refuse, and why.
#
# Both exit 2, with nothing changed, when the target has uncommitted changes
# under spec/ (modified, staged, untracked or ignored files: they are printed),
# when this repo has (modified, staged or untracked), when the target is not
# the top of another git checkout, or when its spec/ is a link or a file. So
# every file --apply removes is in the target's history. No network, no
# commits, no push.
set -u
# Every git command here names its checkout with -C; a GIT_DIR or GIT_WORK_TREE
# inherited from the environment (a hook's, say) would point it elsewhere. A
# CDPATH would send the cd of a relative path elsewhere, or have it print the
# directory into $root.
unset CDPATH GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

me=$(basename "$0")

usage() {
	echo "usage: $me <path-to-cashu-javacard-checkout> [--apply]"
}

die() {
	echo "$me: $*" >&2
	exit 2
}

# What git status says is uncommitted under spec/ in the checkout at $1;
# $2 is --ignored to list the ignored files there as well.
dirt() {
	git -C "$1" --no-optional-locks status --porcelain --untracked-files=all ${2:+"$2"} -- spec
}

# For each "<commit>:spec" on stdin, what spec/ is in that commit of the
# checkout at $1: "tree <id>" when a directory, "blob <id>" when a file or a
# link, and "<commit>:spec missing" when there is none (or no commit).
objects() {
	git -C "$1" cat-file --batch-check='%(objecttype) %(objectname)'
}

target=
apply=0
for arg in "$@"; do
	case $arg in
	--apply) apply=1 ;;
	-h | --help)
		usage
		exit 0
		;;
	-*)
		usage >&2
		die "unknown option $arg"
		;;
	*)
		if [ -n "$target" ]; then
			usage >&2
			die "one target only"
		fi
		target=$arg
		;;
	esac
done
if [ -z "$target" ]; then
	usage >&2
	exit 2
fi

# This repo is the checkout the script sits in, at tools/.
root=$(cd "$(dirname "$0")/.." && pwd -P) || die "cannot find the checkout this script is in"
top=$(git -C "$root" rev-parse --show-toplevel 2>/dev/null) || die "$root is not a git checkout"
[ "$top" = "$root" ] || die "the script is not at tools/ of a checkout ($root)"
head=$(git -C "$root" rev-parse --short HEAD 2>/dev/null) || die "$root has no commit"
branch=$(git -C "$root" symbolic-ref -q --short HEAD) || branch="detached HEAD"
at="$head ($branch)"

[ -d "$target" ] || die "$target is not a directory"
dst=$(cd "$target" && pwd -P) || die "cannot enter $target"
dtop=$(git -C "$dst" rev-parse --show-toplevel 2>/dev/null) || die "$target is not a git checkout"
[ "$dtop" = "$dst" ] || die "$target is inside the checkout at $dtop: give the top of the checkout"
[ "$dst" != "$root" ] || die "$target is this repo"
if [ -L "$dst/spec" ] || { [ -e "$dst/spec" ] && [ ! -d "$dst/spec" ]; }; then
	die "$dst/spec is not a directory"
fi

dirty=$(dirt "$root") || die "git status failed in $root"
if [ -n "$dirty" ]; then
	echo "$me: $root has uncommitted changes under spec/, and the mirror copies spec/ as committed; commit or stash them first:" >&2
	printf '%s\n' "$dirty" >&2
	exit 2
fi
dirty=$(dirt "$dst" --ignored) || die "git status failed in $dst"
if [ -n "$dirty" ]; then
	echo "$me: $dst has uncommitted changes under spec/; commit, stash or remove them first:" >&2
	printf '%s\n' "$dirty" >&2
	exit 2
fi

# Why --apply may not copy HEAD, a reason a line; empty when it may.
nl='
'
refusal=
# HEAD has merged: it is in the history of origin/main, as last fetched.
if ! git -C "$root" rev-parse -q --verify 'refs/remotes/origin/main^{commit}' >/dev/null; then
	refusal="$root has no origin/main to tell whether HEAD has merged: fetch origin there"
else
	git -C "$root" merge-base --is-ancestor HEAD refs/remotes/origin/main
	case $? in
	0) ;;
	1) refusal="HEAD, $at, is not in origin/main: it has not merged, or merged after origin/main was last fetched; mirror from main once the PR has merged, after a pull" ;;
	*) die "git merge-base failed in $root" ;;
	esac
fi
# The mirror moves forward only: the spec/ the target has committed is one
# that spec/ here has been at in HEAD's history, every commit that changed it
# on every side of every merge (--full-history). A target with no spec/
# committed has nothing the copy could take back.
dspec=$(echo HEAD:spec | objects "$dst") || die "git cat-file failed in $dst"
case $dspec in
'tree '*)
	if ! git -C "$root" rev-list --full-history HEAD -- spec | sed 's/$/:spec/' | objects "$root" | grep -qxF "$dspec"; then
		refusal="${refusal:+$refusal$nl}the spec/ committed in $dst is not one that spec/ here has been at in the history of HEAD, $at: it was mirrored from a commit this HEAD lacks (pull, or mirror from main), or it was edited there (revert that there)"
	fi
	;;
esac
if [ "$apply" -eq 1 ] && [ -n "$refusal" ]; then
	echo "$me: --apply refuses to copy spec/ from $root at $at into $dst, and nothing is changed:" >&2
	printf '%s\n' "$refusal" | sed 's/^/  /' >&2
	exit 2
fi

tmp=$(mktemp -d "${TMPDIR:-/tmp}/mirror-spec.XXXXXX") || die "mktemp failed"
trap 'rm -rf "$tmp"' EXIT
trap 'exit 2' HUP INT TERM

# a/spec is the target's and b/spec this repo's at HEAD: the diff is what
# --apply changes in the target.
mkdir "$tmp/a" "$tmp/a/spec" "$tmp/b" || die "cannot write to $tmp"
git -C "$root" archive --format=tar -o "$tmp/spec.tar" HEAD spec 2>/dev/null || die "spec/ is not in $root at HEAD"
tar -xf "$tmp/spec.tar" -C "$tmp/b" || die "cannot unpack spec/ from $root"
[ -d "$tmp/b/spec" ] || die "spec/ is not in $root at HEAD"
if [ -d "$dst/spec" ]; then
	cp -R "$dst/spec/." "$tmp/a/spec/" || die "cannot read $dst/spec"
fi

# Identical is what diff -rq finds: the same files, byte for byte, where a file
# on one side only is a difference, an empty one too. The patch is diff -ruN,
# which prints a file on one side only as lines added or removed, and so prints
# nothing for an empty one; the dry run lists what differs as well.
(cd "$tmp" || exit 2; exec diff -rq a/spec b/spec) >"$tmp/differs"
rc=$?
[ "$rc" -le 1 ] || die "diff failed"

if [ "$apply" -eq 0 ]; then
	(cd "$tmp" || exit 2; exec diff -ruN a/spec b/spec) >"$tmp/diff"
	[ $? -le 1 ] || die "diff failed"
	cat "$tmp/diff"
	if [ "$rc" -eq 0 ]; then
		echo "$me: spec/ in $dst is identical to $root at $at" >&2
	else
		echo "$me: spec/ in $dst differs from $root at $at:" >&2
		sed 's/^/  /' "$tmp/differs" >&2
	fi
	if [ -n "$refusal" ]; then
		echo "$me: --apply would refuse here, and exit 2:" >&2
		printf '%s\n' "$refusal" | sed 's/^/  /' >&2
	elif [ "$rc" -ne 0 ]; then
		echo "$me: --apply copies it" >&2
	fi
	exit "$rc"
fi

if [ "$rc" -eq 0 ]; then
	echo "$me: spec/ in $dst is identical to $root at $at; nothing copied" >&2
else
	rm -rf "$dst/spec" || die "cannot remove $dst/spec (restore it with: git -C $dst checkout -- spec)"
	cp -R "$tmp/b/spec" "$dst/spec" || die "the copy failed (restore with: git -C $dst checkout -- spec)"
	diff -r "$tmp/b/spec" "$dst/spec" >/dev/null || die "$dst/spec still differs after the copy"
	echo "$me: copied spec/ from $root at $at into $dst; review it with git -C $dst diff, then commit and push there" >&2
fi
git -C "$dst" status --short || die "git status failed in $dst"
exit 0
