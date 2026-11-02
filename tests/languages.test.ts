import assert from "node:assert/strict";
import { test } from "node:test";
import { scan } from "../scanner/build.ts";

test("scans Kotlin, Rust and Vue, and links a Vue call to a Rust route", async () => {
  const { map } = await scan({ roots: ["tests/fixtures/polyglot"] });
  const byId = new Map(map.files.map((f) => [f.id, f]));
  assert.deepEqual(byId.get("kt/ArticleApi.kt")?.routes.map((r) => r.path), ["/articles/:p"]);
  assert.ok(byId.get("vue/ArticleCard.vue")?.texts?.includes("Save the comment"), "template text is indexed");
  const edges = map.edges.map((e) => `${e.type} ${e.from} -> ${e.to}`);
  assert.ok(edges.includes("http vue/ArticleCard.vue -> rs/src/main.rs"));
  assert.ok(edges.includes("import rs/src/main.rs -> rs/src/models/article.rs"));
  assert.ok(edges.includes("import kt/ArticleApi.kt -> kt/Article.kt"), "Kotlin import resolved through its package");
});
