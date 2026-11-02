import type { Relation } from "../../shared/analyze.ts";

// Plain words for the graph's terms, for people who don't think in
// "downstream" and "upstream".
export const RELATION_LABEL: Record<Relation, string> = {
  direct: "Directly involved",
  downstream: "Could break",
  upstream: "Relied on",
};

export const RELATION_BADGE: Record<Relation, string> = {
  direct: "direct",
  downstream: "could break",
  upstream: "relied on",
};

export const RELATION_HELP: Record<Relation, string> = {
  direct: "What the description is about, or a file the change touched.",
  downstream: "Depends on a directly involved file (imports it, calls its API, uses its data), so the change can break it.",
  upstream: "A directly involved file depends on it. It usually stays as it is, but the feature may need something new from it.",
};
