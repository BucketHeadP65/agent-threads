import { describe, expect, it } from "vitest";

import { linkIndexOf } from "./link-index";

describe("linkIndexOf", () => {
  it("maps every id and every alias to its note's path", () => {
    const index = linkIndexOf([
      { path: "notes/lineage.md", id: "data-lineage", aliases: ["lineage-notes", "Lineage"] },
      { path: "glossary/bdn.md", id: "glossary-bdn", aliases: ["BDN"] },
    ]);
    expect(index.get("data-lineage")).toBe("notes/lineage.md");
    expect(index.get("Lineage")).toBe("notes/lineage.md");
    expect(index.get("glossary-bdn")).toBe("glossary/bdn.md");
    expect(index.get("BDN")).toBe("glossary/bdn.md");
  });

  it("lets an id win over another page's identical alias", () => {
    const index = linkIndexOf([
      { path: "one.md", id: null, aliases: ["shared-id"] },
      { path: "two.md", id: "shared-id", aliases: [] },
    ]);
    expect(index.get("shared-id")).toBe("two.md");
  });

  it("keeps the first page on a duplicate alias", () => {
    const index = linkIndexOf([
      { path: "one.md", id: null, aliases: ["shared"] },
      { path: "two.md", id: null, aliases: ["shared"] },
    ]);
    expect(index.get("shared")).toBe("one.md");
  });

  it("skips empty ids and aliases", () => {
    const index = linkIndexOf([{ path: "one.md", id: null, aliases: [""] }]);
    expect(index.size).toBe(0);
  });
});
