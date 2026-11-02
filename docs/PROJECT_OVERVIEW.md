# Project overview

Code Intelligence and Change Impact Analysis Engine. Guru R Bharadwaj (PES1UG24CS177) and Vivian Sobers E (PES1UG24CS901), section 5 C.

## Problem statement

A developer about to change a function in an unfamiliar codebase has to answer a few questions before they touch it. What calls this function, directly or through other functions? Which entry points (routes, CLI commands, `main`) end up running it? Who changed it recently, and how often does it change? Is the same logic copied somewhere else, so that a fix here also needs a fix there?

Git and an editor answer each of these slowly and separately. `git log` lists commits but not which functions they touched. Text search finds names but not callers through two levels of indirection, and it cannot find code that does the same thing under a different name.

This project reads a Git repository into a database and answers those questions from it. Code structure (files, symbols, calls, imports) goes into PostgreSQL. Each file's syntax tree goes into MongoDB. Commit history is mapped onto the symbols each commit changed. Function bodies are embedded as vectors with pgvector, so the app can find duplicated code and search by meaning.

## Objectives

1. Parse JavaScript, TypeScript, Python, Java and Go repositories into a relational model of files, symbols, calls and imports, with the full syntax tree of each file kept as a MongoDB document.
2. Given a symbol, list every symbol and entry point that can reach it through the call graph, with a recursive query inside the database.
3. Read the whole Git history of a repository and record, for each commit, which symbols it added or modified and by how many lines.
4. Show change hotspots, per-file ownership and per-author churn from views over that history.
5. Embed every function and method body with a local code embedding model, search them with a plain-language description, and group near-duplicates into clone clusters that an admin reviews.
6. Put all of this behind a Next.js web app with two roles, Admin and Developer, enforced both in the app and in the database.
