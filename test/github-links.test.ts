import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isGithubLogin,
  isGithubFullName,
  githubRepoUrl,
  githubUserUrl,
  splitGithubLinkParts,
  linkifyGithubHtml,
} from "../packages/core/src/github-links.js";

describe("isGithubLogin", () => {
  it("accepts normal logins", () => {
    assert.equal(isGithubLogin("haelyra"), true);
    assert.equal(isGithubLogin("affaan-m"), true);
    assert.equal(isGithubLogin("a"), true);
  });

  it("rejects display names and junk", () => {
    assert.equal(isGithubLogin("张三"), false);
    assert.equal(isGithubLogin("-oops"), false);
    assert.equal(isGithubLogin("oops-"), false);
    assert.equal(isGithubLogin("has space"), false);
  });
});

describe("isGithubFullName", () => {
  it("accepts owner/repo", () => {
    assert.equal(isGithubFullName("affaan-m/ECC"), true);
    assert.equal(isGithubFullName("vercel/next.js"), true);
  });

  it("rejects unsafe or malformed", () => {
    assert.equal(isGithubFullName("owner/repo/extra"), false);
    assert.equal(isGithubFullName('owner/repo"onclick'), false);
    assert.equal(isGithubFullName("../etc"), false);
  });
});

describe("splitGithubLinkParts", () => {
  it("links fullName before owner login to avoid nested anchors", () => {
    const parts = splitGithubLinkParts("项目 · affaan-m/ECC by affaan-m", {
      fullName: "affaan-m/ECC",
      logins: ["affaan-m", "haelyra"],
    });
    assert.deepEqual(parts, [
      { type: "text", value: "项目 · " },
      { type: "repo", value: "affaan-m/ECC" },
      { type: "text", value: " by " },
      { type: "user", value: "affaan-m" },
    ]);
  });

  it("does not link short login inside a longer handle", () => {
    const parts = splitGithubLinkParts("thanks samartomar and sam", {
      logins: ["sam", "samartomar"],
    });
    assert.deepEqual(parts, [
      { type: "text", value: "thanks " },
      { type: "user", value: "samartomar" },
      { type: "text", value: " and " },
      { type: "user", value: "sam" },
    ]);
  });

  it("does not link single-letter login in prose by default", () => {
    const parts = splitGithubLinkParts("a plan by a", { logins: ["a"] });
    assert.deepEqual(parts, [{ type: "text", value: "a plan by a" }]);
  });

  it("does not link login as substring of another word", () => {
    const parts = splitGithubLinkParts("category and cat", { logins: ["cat"] });
    assert.deepEqual(parts, [
      { type: "text", value: "category and " },
      { type: "user", value: "cat" },
    ]);
  });
});

describe("linkifyGithubHtml", () => {
  it("escapes HTML and builds safe anchors", () => {
    const html = linkifyGithubHtml('see <b>affaan-m/ECC</b> and haelyra', {
      fullName: "affaan-m/ECC",
      logins: ["haelyra"],
      className: "repo-gossip-link",
    });
    assert.match(html, /&lt;b&gt;/);
    assert.match(
      html,
      /href="https:\/\/github\.com\/affaan-m\/ECC"/,
    );
    assert.match(
      html,
      /href="https:\/\/github\.com\/haelyra"/,
    );
    assert.doesNotMatch(html, /<b>/);
  });

  it("encodes repo URL segments", () => {
    assert.equal(
      githubRepoUrl("vercel/next.js"),
      "https://github.com/vercel/next.js",
    );
    assert.equal(githubUserUrl("haelyra"), "https://github.com/haelyra");
  });
});
