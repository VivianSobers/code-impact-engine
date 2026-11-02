#!/bin/sh
set -u

root="${CIE_DB_ROOT:-/cie-db}"
db="${CIE_TEST_DB:-cie_test}"
export PGOPTIONS="-c client_min_messages=warning"

admin() {
  psql -v ON_ERROR_STOP=1 -q --username "$POSTGRES_USER" --dbname postgres -c "$1"
}

admin "DROP DATABASE IF EXISTS \"$db\"" || exit 1
admin "CREATE DATABASE \"$db\"" || exit 1

if ! CIE_DB="$db" CIE_DB_ROOT="$root" sh "$root/init/apply.sh" > /dev/null; then
  echo "schema failed to apply to $db"
  exit 1
fi

status=0
for f in "$root"/tests/*.sql; do
  [ -e "$f" ] || continue
  if psql -v ON_ERROR_STOP=1 -q --username "$POSTGRES_USER" --dbname "$db" -f "$f" > /dev/null; then
    echo "pass  $(basename "$f")"
  else
    echo "FAIL  $(basename "$f")"
    status=1
  fi
done

[ "${CIE_TEST_KEEP:-0}" = 1 ] || admin "DROP DATABASE \"$db\""
exit $status
