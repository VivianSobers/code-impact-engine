# History, similarity and access screenshots

These pages run on real ingested data from the seed repo and expressjs/express. They were captured in Chrome at a 1440 by 900 viewport. [tests/history/screenshots.mjs](../tests/history/screenshots.mjs) retakes them.

## Authentication and administration

The sign-in page enforcing username, password, session cookies, and brute-force throttling.

![Login page](screenshots/history/01-login.png)

The admin user management page where administrators create accounts and assign roles (`admin` or `developer`).

![Admin user management](screenshots/history/08-admin-users.png)

## History dashboard

The history dashboard overview displaying high-level repository totals, change hotspots (`v_symbol_hotspot`), and lines changed per author with interactive filtering by repository.

![History dashboard](screenshots/history/02-dashboard.png)

## Commit history

The commit history page listing commits newest first, with author attribution, changed symbol counts, net churn, repository filtering, and full-text search with English stemming.

![Commit history list](screenshots/history/03-commits.png)

The commit detail view showing the exact symbols added or modified by the commit diff, line ranges, and additions/deletions.

![Commit detail](screenshots/history/04-commit-detail.png)

## Semantic code search

Semantic search ranking functions and methods by meaning using the 768-dimensional local code embedding model and pgvector cosine distance against the user's natural language query.

![Semantic search](screenshots/history/05-semantic-search.png)

## Clone review and waivers

The clone review queue displaying detected near-duplicate clusters filtered by status (`open`, `confirmed`, `dismissed`) and repository.

![Clone review queue](screenshots/history/06-clones-queue.png)

The clone cluster review page showing member symbol line comparisons, source code snippets from repository checkouts, and admin review actions to confirm or dismiss clusters and record per-symbol waivers with reasons.

![Clone cluster review](screenshots/history/07-clone-detail.png)
