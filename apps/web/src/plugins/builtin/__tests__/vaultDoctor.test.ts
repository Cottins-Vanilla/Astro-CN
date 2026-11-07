import { describe, expect, it } from "vitest";
import { auditVault } from "../vaultDoctor";

function note(id: string, title: string, body: string) {
  return { id, title, body };
}

describe("auditVault", () => {
  it("flags a wiki-link with no matching note title as broken", () => {
    const report = auditVault([note("1", "Alpha", "See [[Nowhere]] for details."), note("2", "Beta", "")]);
    expect(report.brokenLinks).toEqual([{ fromTitle: "Alpha", target: "Nowhere" }]);
  });

  it("resolves link targets case-insensitively and strips |alias", () => {
    const report = auditVault([note("1", "Alpha", "See [[beta|the other one]]."), note("2", "Beta", "")]);
    expect(report.brokenLinks).toEqual([]);
    expect(report.orphanTitles).toEqual(["Alpha"]);
  });

  it("finds notes with zero inbound links as orphans", () => {
    // Alpha links out to Beta but receives no inbound link itself, so it's an orphan too —
    // only Beta (the link target) has an inbound link.
    const report = auditVault([note("1", "Alpha", "[[Beta]]"), note("2", "Beta", ""), note("3", "Gamma", "")]);
    expect(report.orphanTitles).toEqual(["Alpha", "Gamma"]);
  });

  it("groups duplicate titles case-insensitively", () => {
    const report = auditVault([note("1", "Alpha", ""), note("2", "alpha", ""), note("3", "Beta", "")]);
    expect(report.duplicateGroups).toEqual([{ titles: ["Alpha", "alpha"] }]);
  });

  it("reports a clean vault with all-empty sections", () => {
    const report = auditVault([note("1", "Alpha", "[[Beta]]"), note("2", "Beta", "[[Alpha]]")]);
    expect(report).toEqual({ brokenLinks: [], orphanTitles: [], duplicateGroups: [] });
  });
});
