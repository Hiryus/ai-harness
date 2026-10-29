#!/usr/bin/env bash
# Links the harness directories to this repository, wherever it is cloned. Safe to run several times:
# a correct link is kept, and a link elsewhere is replaced.
# An existing claude code or opencode installation is copied into the repository (its files never overwrite the repository's),
# then replaced by the link and deleted.
set -euo pipefail

REPOSITORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# copy_missing <source> <destination>: copy the content of <source> into <destination>, keeping the files already there.
# Links are copied as links, not followed.
copy_missing() {
  local source="$1" destination="$2" relative
  (cd "$source" && find . -mindepth 1 -print0) | while IFS= read -r -d '' relative; do
    relative="${relative#./}"
    if [ -d "$source/$relative" ] && [ ! -L "$source/$relative" ]; then
      mkdir -p "$destination/$relative"
    elif [ -e "$destination/$relative" ] || [ -L "$destination/$relative" ]; then
      echo "kept:    $destination/$relative (the installed one is discarded)"
    else
      cp -a "$source/$relative" "$destination/$relative"
    fi
  done
}

# link <target> <path> [migrate]: make <path> a symbolic link to <target>.
# With `migrate`, an existing directory is copied into <target> first, then deleted.
link() {
  local target="$1" path="$2" migrate="${3:-}" action migrated=""
  if [ -L "$path" ]; then
    if [ "$(readlink "$path")" = "$target" ]; then
      echo "ok:      $path -> $target"
      return
    fi
    rm "$path"
    action="updated"
  elif [ -d "$path" ] && [ "$migrate" = "migrate" ]; then
    copy_missing "$path" "$target"
    # Moved aside rather than deleted right away: the installation is only deleted once the link exists.
    migrated="$path.migrated"
    mv "$path" "$migrated"
    action="migrated"
  elif [ -e "$path" ]; then
    echo "skipped: $path exists and is not a link, move it away and run again" >&2
    return
  else
    action="created"
  fi
  mkdir -p "$(dirname "$path")"
  ln -s "$target" "$path"
  echo "$action: $path -> $target"
  if [ -n "$migrated" ]; then
    # `rm -r` deletes the links it contains, never the directories they point to.
    rm -rf "$migrated"
    echo "deleted: $migrated"
  fi
}

# First, so that an installed `scripts` or `skills` is migrated into the shared directories.
# Relative, so that they resolve from the repository whatever links to it.
link ../scripts "$REPOSITORY/claude/scripts"
link ../skills "$REPOSITORY/claude/skills"
link "$REPOSITORY/claude" "$HOME/.claude" migrate
link "$REPOSITORY/opencode" "$HOME/.config/opencode" migrate
