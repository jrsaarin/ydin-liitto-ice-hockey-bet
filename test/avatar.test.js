import test from "node:test";
import assert from "node:assert/strict";
import { avatarProblem, avatarsVersion, MAX_AVATAR_LENGTH } from "../worker/avatar.js";

const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";

test("a small JPEG, PNG or WebP data URL is accepted", () => {
  assert.equal(avatarProblem(jpeg), null);
  assert.equal(avatarProblem("data:image/png;base64,iVBORw0KGgo="), null);
  assert.equal(avatarProblem("data:image/webp;base64,UklGRg=="), null);
});

test("anything that is not an image data URL is refused", () => {
  assert.match(avatarProblem(undefined), /missing/);
  assert.match(avatarProblem(42), /missing/);
  assert.match(avatarProblem("https://example.com/me.jpg"), /JPEG, PNG or WebP/);
  assert.match(avatarProblem("data:text/html;base64,PHNjcmlwdD4="), /JPEG, PNG or WebP/);
  assert.match(avatarProblem("data:image/svg+xml;base64,PHN2Zz4="), /JPEG, PNG or WebP/);
  assert.match(avatarProblem('data:image/jpeg;base64,AAAA" onerror="x'), /JPEG, PNG or WebP/);
});

test("oversized pictures are refused", () => {
  const big = "data:image/jpeg;base64," + "A".repeat(MAX_AVATAR_LENGTH);
  assert.match(avatarProblem(big), /too large/);
});

test("the version changes when a picture is added, replaced or removed", () => {
  const one = [{ name: "R", updatedAt: "2026-09-28T10:00:00.000Z" }];
  const two = [...one, { name: "AV", updatedAt: "2026-09-28T09:00:00.000Z" }];
  const replaced = [{ name: "R", updatedAt: "2026-09-28T11:00:00.000Z" }];
  const versions = [avatarsVersion([]), avatarsVersion(one), avatarsVersion(two), avatarsVersion(replaced)];
  assert.equal(new Set(versions).size, 4);
  assert.equal(avatarsVersion([]), "0:");
});
