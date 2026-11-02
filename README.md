# Code Intelligence and Change Impact Analysis Engine

UE23CS351A Database Management Systems, Level 3 project. Guru R Bharadwaj (PES1UG24CS177) and Vivian Sobers E (PES1UG24CS901), class 5 C.

The engine ingests a Git repository, parses its source into files, symbols, call edges and imports, and records which commits touched which symbols. With that data it answers questions like:

- If I change this function, which callers and entry points are affected?
- Which parts of the code change most often, and who usually changes them?
- Where is code duplicated across the repo?
- Which function does what I am describing, even if I don't know its name?

