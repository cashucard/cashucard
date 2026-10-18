#!/bin/sh
# Mirror this repo's spec/ into a checkout of lnflash/cashu-javacard, the
# protocol reference, which takes no spec edits of its own (AGENTS.md). Run it
# after a PR that touches spec/ merges here:
#
#   tools/mirror-spec.sh <path-to-cashu-javacard-checkout>           dry run
#   tools/mirror-spec.sh <path-to-cashu-javacard-checkout> --apply   copy
#
# The dry run prints a unified diff of spec/, the target's (a/) against this
# repo's (b/), and exits 0 when they are identical and 1 when they differ.
# --apply makes the target's spec/ this repo's, removing what is no longer
# here, then prints `git -C <target> status --short`; committing and pushing
# there are the operator's. What is copied is spec/ as committed at this repo's
# HEAD, and nothing outside spec/ is touched on either side.
#
# Exit 2, with nothing changed, when the target has uncommitted changes under
# spec/ (modified, staged, untracked or ignored files: they are printed), when
# this repo has (modified, staged or untracked), when the target is not the top
# of another git checkout, or when its spec/ is a link or a file. So every file
# --apply removes is in the target's history. No network, no commits, no push.
set -u
# Every git command here names its checkout with -C; a GIT_DIR or GIT_WORK_TREE
# inherited from the environment (a hook's, say) would point it elsewhere.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

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

(cd "$tmp" || exit 2; exec diff -ruN a/spec b/spec) >"$tmp/diff"
rc=$?
[ "$rc" -le 1 ] || die "diff failed"

if [ "$apply" -eq 0 ]; then
	cat "$tmp/diff"
	if [ "$rc" -eq 0 ]; then
		echo "$me: spec/ in $dst is identical to $root at $head" >&2
	else
		echo "$me: spec/ in $dst differs from $root at $head; --apply copies it" >&2
	fi
	exit "$rc"
fi

if [ "$rc" -eq 0 ]; then
	echo "$me: spec/ in $dst is identical to $root at $head; nothing copied" >&2
else
	rm -rf "$dst/spec" || die "cannot remove $dst/spec (restore it with: git -C $dst checkout -- spec)"
	cp -R "$tmp/b/spec" "$dst/spec" || die "the copy failed (restore with: git -C $dst checkout -- spec)"
	diff -r "$tmp/b/spec" "$dst/spec" >/dev/null || die "$dst/spec still differs after the copy"
	echo "$me: copied spec/ from $root at $head into $dst; review it with git -C $dst diff, then commit and push there" >&2
fi
git -C "$dst" status --short || die "git status failed in $dst"
exit 0
