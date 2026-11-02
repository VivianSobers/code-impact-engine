import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { companyFromEmail, groupAuthors } from "../src/authors";

function commit(authorName: string, authorEmail: string, committedAt: string) {
  return { authorName, authorEmail, committedAt };
}

describe("companyFromEmail", () => {
  it("names the company after the email domain", () => {
    assert.equal(companyFromEmail("asha.rao@acme.example"), "Acme");
    assert.equal(companyFromEmail("dev@eng.globex.com"), "Globex");
    assert.equal(companyFromEmail("ops@initech.co.uk"), "Initech");
    assert.equal(companyFromEmail("student@pesu.ac.in"), "Pesu");
  });

  it("returns null for personal and no-reply addresses", () => {
    assert.equal(companyFromEmail("ben.okafor@gmail.com"), null);
    assert.equal(companyFromEmail("someone@outlook.com"), null);
    assert.equal(companyFromEmail("123+octocat@users.noreply.github.com"), null);
    assert.equal(companyFromEmail("bot@noreply.example.com"), null);
    assert.equal(companyFromEmail("root@localhost"), null);
  });
});

describe("groupAuthors", () => {
  it("merges emails used under the same name and takes the latest company", () => {
    const authors = groupAuthors([
      commit("Ben Okafor", "ben@acme.example", "2026-09-02T11:30:00+05:30"),
      commit("Asha Rao", "Asha.Rao@Acme.example", "2026-09-03T09:00:00+05:30"),
      commit("Ben Okafor", "ben.okafor@globex.example", "2026-09-05T21:45:00+05:30"),
      commit("ben okafor ", "ben@acme.example", "2026-09-08T10:40:00+05:30"),
    ]);
    assert.deepEqual(authors, [
      { name: "Ben Okafor", company: "Acme", emails: ["ben.okafor@globex.example", "ben@acme.example"] },
      { name: "Asha Rao", company: "Acme", emails: ["asha.rao@acme.example"] },
    ]);
  });

  it("falls back to an earlier company when the latest email is personal", () => {
    const authors = groupAuthors([
      commit("Chen Li", "chen.li@acme.example", "2026-09-04T10:05:00+05:30"),
      commit("Chen Li", "chen.li@gmail.com", "2026-09-09T14:15:00+05:30"),
    ]);
    assert.deepEqual(authors, [{ name: "Chen Li", company: "Acme", emails: ["chen.li@acme.example", "chen.li@gmail.com"] }]);
  });

  it("treats two names on one email address as one person, named by the latest commit", () => {
    const authors = groupAuthors([
      commit("asha", "asha.rao@acme.example", "2026-09-01T09:00:00+05:30"),
      commit("Asha Rao", "asha.rao@acme.example", "2026-09-07T16:00:00+05:30"),
      commit("Asha Rao", "asha@globex.example", "2026-09-08T16:00:00+05:30"),
    ]);
    assert.deepEqual(authors, [
      { name: "Asha Rao", company: "Globex", emails: ["asha.rao@acme.example", "asha@globex.example"] },
    ]);
  });

  it("does not merge different people who both left the email empty", () => {
    const authors = groupAuthors([
      commit("Ana", "", "2026-09-01T00:00:00Z"),
      commit("Ben", "", "2026-09-02T00:00:00Z"),
    ]);
    assert.deepEqual(authors, [
      { name: "Ana", company: null, emails: [] },
      { name: "Ben", company: null, emails: [] },
    ]);
  });

  it("uses the email as the name when a commit has no author name", () => {
    assert.deepEqual(groupAuthors([commit("", "anon@example.org", "2026-09-01T00:00:00Z")]), [
      { name: "anon@example.org", company: "Example", emails: ["anon@example.org"] },
    ]);
  });
});
