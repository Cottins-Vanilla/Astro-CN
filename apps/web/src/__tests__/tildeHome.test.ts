import { describe, expect, it } from "vitest";
import { tildeHome } from "../mcpPaths";

describe("tildeHome", () => {
  it("collapses a home directory prefix on both platforms", () => {
    expect(tildeHome("C:\\Users\\you\\.cursor\\mcp.json")).toBe("~\\.cursor\\mcp.json");
    expect(tildeHome("C:/Users/you/.cursor/mcp.json")).toBe("~/.cursor/mcp.json");
    expect(tildeHome("/home/you/.cursor/mcp.json")).toBe("~/.cursor/mcp.json");
    expect(tildeHome("/Users/you/Library/Application Support/Claude/x.json")).toBe(
      "~/Library/Application Support/Claude/x.json",
    );
  });

  it("keeps the account name out of the string entirely", () => {
    // The whole point: this string is rendered in Settings and ends up in any screenshot of it.
    const shown = tildeHome("C:\\Users\\you\\AppData\\Local\\Packages\\Claude_pzs8sxrjxfjjc\\LocalCache");
    expect(shown).not.toContain("you");
    expect(shown).not.toContain("Users");
  });

  it("leaves a path outside any home directory untouched", () => {
    // Collapsing by shape can't know the real home dir, and shouldn't guess — a system-wide path
    // stays verbatim rather than being mangled into a `~` that would be wrong.
    expect(tildeHome("D:\\vaults\\shared\\mcp.json")).toBe("D:\\vaults\\shared\\mcp.json");
    expect(tildeHome("/opt/astro/mcp.json")).toBe("/opt/astro/mcp.json");
  });
});
