# Code structure tests

## API smoke test

`api.test.mjs` calls every code structure API route against a running server. It checks a success case and the 400 and 404 cases for each route. It finds repository, file and symbol ids through the API, so it needs no fixed ids, but at least one repository with calls must be ingested first.

It uses only Node's built-in test runner and `fetch`, so there is nothing to install.

```sh
CIE_TEST_USERNAME=ana CIE_TEST_PASSWORD=... node --test tests/structure/api.test.mjs
```

Environment variables:

- `CIE_TEST_USERNAME` and `CIE_TEST_PASSWORD` are a user of the app. The test signs in through `POST /api/session` before calling anything. Use an admin when `INGEST_SOURCE` is set, since only admins can add repositories.
- `BASE_URL` is the server to test. The default is `http://localhost:3000`.
- `INGEST_SOURCE` is a Git URL or absolute path. When set, the test also adds that repository with `POST /api/repositories`. When unset, that one test is skipped, so a normal run writes nothing to the database.

```sh
BASE_URL=http://localhost:3100 INGEST_SOURCE=https://github.com/sindresorhus/slugify node --test tests/structure/api.test.mjs
```

"returns 400 for a malformed path" fails on a production server (`next start`). See the known failure in [docs/STRUCTURE_TEST_RESULTS.md](../../docs/STRUCTURE_TEST_RESULTS.md).

## Screenshots

`screenshots.mjs` drives Microsoft Edge through the pages and writes PNGs to `docs/screenshots/structure/`. It needs `seed-repo` and `express` ingested and `playwright-core` installed. `playwright-core` is not a project dependency, so install it somewhere outside the repository and copy the script next to it.

`BASE_URL` works as above. `OUT_DIR` changes the output folder, `ADD_SOURCE` picks the repository added through the form, and `BROWSER_CHANNEL` picks another installed browser.

```sh
OUT_DIR=/path/to/repo/docs/screenshots/structure node screenshots.mjs
```
