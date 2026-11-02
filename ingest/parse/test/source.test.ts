import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { workdir } from "../src/config";
import { grammarFor, languageOf } from "../src/languages";
import { isRemote, looksMinified, nameFromUrl, skipReason, workdirFor } from "../src/source";

describe("source helpers", () => {
  it("tells git URLs from local paths", () => {
    assert.equal(isRemote("https://github.com/acme/shop.git"), true);
    assert.equal(isRemote("git@github.com:acme/shop.git"), true);
    assert.equal(isRemote("ssh://git@host/acme/shop"), true);
    assert.equal(isRemote("C:\code\shop"), false);
    assert.equal(isRemote("../shop"), false);
  });

  it("names repositories and their clone directories after the URL", () => {
    assert.equal(nameFromUrl("https://github.com/acme/shop.git"), "shop");
    assert.equal(nameFromUrl("git@github.com:acme/shop.git"), "shop");
    assert.equal(nameFromUrl("/home/me/code/shop/"), "shop");
    assert.equal(workdirFor("https://github.com/acme/shop.git"), path.join(workdir, "acme-shop"));
    assert.equal(workdirFor("git@github.com:acme/shop.git"), path.join(workdir, "acme-shop"));
  });

  it("skips vendored, generated and oversized files", () => {
    assert.equal(skipReason("src/app.ts", 100), null);
    assert.ok(skipReason("node_modules/react/index.js", 100));
    assert.ok(skipReason("web/dist/app.js", 100));
    assert.ok(skipReason("static/jquery.min.js", 100));
    assert.ok(skipReason("api/service.pb.go", 100));
    assert.ok(skipReason("types/global.d.ts", 100));
    assert.ok(skipReason("src/big.ts", 2 * 1024 * 1024));
  });

  it("spots minified and binary content", () => {
    assert.equal(looksMinified("const a = 1;\nconst b = 2;\n"), false);
    assert.equal(looksMinified(`var a=${"1+".repeat(4000)}1;`), true);
    assert.equal(looksMinified("abc\u0000def"), true);
  });

  it("maps extensions to grammars and languages", () => {
    assert.equal(grammarFor("a/b.tsx"), "tsx");
    assert.equal(languageOf("tsx"), "typescript");
    assert.equal(grammarFor("a/b.MJS"), "javascript");
    assert.equal(grammarFor("main.go"), "go");
    assert.equal(grammarFor("README.md"), null);
  });
});
