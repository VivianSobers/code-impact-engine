# Code structure screenshots

These pages run on real ingested data: the seed repo, psf/requests, expressjs/express and sindresorhus/slugify. They were captured in Microsoft Edge at a 1440 by 900 viewport. [tests/structure/screenshots.mjs](../tests/structure/screenshots.mjs) retakes them.

## Repositories

The repository list with each repository's languages and counts.

![Repository list](screenshots/structure/01-repositories.png)

The add-repository form while a repository is being cloned and parsed.

![Add-repository form, parsing](screenshots/structure/02-add-repository-pending.png)

The same form after the parse finishes, with a summary of what was stored.

![Add-repository form, finished](screenshots/structure/03-add-repository-success.png)

The seed repo's file tree next to AST statistics from MongoDB.

![Repository page](screenshots/structure/04-repository.png)

## Files and symbols

A file's declared symbols, with the files it imports and the files that import it.

![File detail](screenshots/structure/05-file-detail.png)

`OrderService.create` with its signature, callers and callees.

![Symbol detail](screenshots/structure/06-symbol-detail.png)

## Call graph and impact

The call graph for `priceOrder`, two steps in each direction.

![Call graph for priceOrder](screenshots/structure/07-call-graph.png)

Impact of changing `roundCurrency`: five affected symbols, one entry point, and the call path to each.

![Impact of roundCurrency](screenshots/structure/08-impact.png)

Search results for `parse` across all repositories.

![Symbol search](screenshots/structure/09-search.png)

## Real repositories

The express repository page, with its 142 files and 108,201 JavaScript syntax nodes.

![Express repository page](screenshots/structure/10-express-repository.png)

Impact of `tryRender` in express, limited to calls with confidence 0.75 or more: 21 symbols in 16 files, 15 of them entry points.

![Impact of tryRender in express](screenshots/structure/11-express-impact.png)

The call graph for `tryRender`. Thin lines are low confidence matches, such as the `render` functions in the test files.

![Call graph for tryRender in express](screenshots/structure/12-express-call-graph.png)
