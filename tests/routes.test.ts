import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeRoute, routeScore, routesMatch } from "../scanner/routes.ts";

test("normalizes route syntax from different frameworks to one shape", () => {
  assert.equal(normalizeRoute("/articles/:slug/comments"), "/articles/:p/comments"); // Express, Gin
  assert.equal(normalizeRoute("/articles/{slug}"), "/articles/:p"); // Spring, ASP.NET
  assert.equal(normalizeRoute("articles/<int:pk>/"), "/articles/:p"); // Django path()
  assert.equal(normalizeRoute("^articles/(?P<article_slug>[-\\w]+)/comments/?$"), "/articles/:p/comments"); // Django url()
  assert.equal(normalizeRoute("/articles/${slug}?limit=10"), "/articles/:p"); // template literal with a query
  assert.equal(normalizeRoute("https://api.example.com/api/v1/Users"), "/api/v1/users");
});

test("matches a client call to the server route that serves it", () => {
  assert.ok(routesMatch("/api/articles/:p", "/articles/:p"));
  assert.ok(routesMatch("/articles/my-post/favorite", "/articles/:p/favorite"));
  assert.ok(!routesMatch("/articles/:p", "/profiles/:p"));
  assert.ok(!routesMatch("/:p", "/:p"), "a route made only of params matches nothing");
});

test("prefers the closer of two matching routes", () => {
  // Both sides are normalized before matching.
  const slug = normalizeRoute("/articles/:slug")!;
  assert.ok(routeScore("/articles/:p", slug) > routeScore("/articles/:p", "/articles/feed"));
});
