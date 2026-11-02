# History, similarity and access tests

## API smoke test

`api.test.mjs` calls every history, search and clone API route against a running server. It checks authentication, parameter validation, search filtering, commit symbol attribution, semantic embeddings, and admin vs developer authorization for clone cluster reviews.

It uses Node's built-in test runner and `fetch`:

```sh
CIE_TEST_USERNAME=ana CIE_TEST_PASSWORD=adminpassword123 CIE_TEST_DEV_USERNAME=ben CIE_TEST_DEV_PASSWORD=devpassword123 node --test tests/history/api.test.mjs
```

Environment variables:

- `CIE_TEST_USERNAME` and `CIE_TEST_PASSWORD`: Admin user credentials for authenticated calls and clone reviews.
- `CIE_TEST_DEV_USERNAME` and `CIE_TEST_DEV_PASSWORD`: Optional developer user credentials to verify 403 access control enforcement.
- `BASE_URL`: Server address (default: `http://localhost:3000`).

## Screenshots

`screenshots.mjs` drives Chromium through the history, commits, search, clone review, and user management pages and writes screenshots to `docs/screenshots/history/`. It requires `playwright-core` installed outside the repository or run alongside installed dependencies.

```sh
BASE_URL=http://localhost:3000 node tests/history/screenshots.mjs
```
