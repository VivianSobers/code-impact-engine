#!/bin/sh
set -eu

target="${CIE_DB:-$POSTGRES_DB}"
root="${CIE_DB_ROOT:-/cie-db}"

for dir in schema functions views seed; do
  for f in "$root"/"$dir"/*.sql; do
    [ -e "$f" ] || continue
    echo "applying $f to $target"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$target" -f "$f"
  done
done
