const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));

const headersBySource = new Map((config.headers ?? []).map((entry) => [entry.source, entry.headers]));
const assetCache = headersBySource.get("/assets/(.*)")?.find((header) => header.key.toLowerCase() === "cache-control")?.value;
const htmlCache = headersBySource.get("/index.html")?.find((header) => header.key.toLowerCase() === "cache-control")?.value;

assert.equal(
  assetCache,
  "public, max-age=31536000, immutable",
  "Los archivos versionados deben reutilizarse sin revalidacion durante un ano."
);
assert.equal(
  htmlCache,
  "public, max-age=0, must-revalidate",
  "El HTML debe revalidarse para descubrir cada version nueva."
);

console.log("OK cache: assets inmutables e index siempre revalidado.");
