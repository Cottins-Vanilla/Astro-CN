import { describe, expect, it } from "vitest";
import { parseNote, serializeNote } from "../frontmatter.js";
import type { Note } from "../types.js";

describe("frontmatter round-trip", () => {
  it("serializes and re-parses a note losslessly", () => {
    const note: Note = {
      id: "n_x1y2z3",
      title: "Distributed systems reading list",
      tags: ["reading", "systems"],
      createdAt: "2026-07-18T12:00:00.000Z",
      updatedAt: "2026-07-18T14:30:00.000Z",
      body: "Notes link to each other with [[Wiki Links]] by title.\nTags can also appear inline as #hashtags.",
    };

    const raw = serializeNote(note);
    expect(raw).toMatch(/^---\n/);
    const parsed = parseNote(note.id, raw);
    expect(parsed).toEqual(note);
  });

  it("round-trips an empty tags list", () => {
    const note: Note = {
      id: "n_abc",
      title: "Untitled",
      tags: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      body: "",
    };
    const parsed = parseNote(note.id, serializeNote(note));
    expect(parsed).toEqual(note);
  });

  it("quotes titles containing special characters", () => {
    const note: Note = {
      id: "n_q",
      title: 'Title: with a colon',
      tags: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      body: "body",
    };
    const parsed = parseNote(note.id, serializeNote(note));
    expect(parsed.title).toBe(note.title);
  });

  it("parses a note whose file was saved with a leading UTF-8 BOM (e.g. Windows Notepad)", () => {
    const note: Note = {
      id: "n_bom",
      title: "BOM Note",
      tags: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      body: "body text",
    };
    const raw = "﻿" + serializeNote(note);
    const parsed = parseNote(note.id, raw);
    expect(parsed).toEqual(note);
  });
});
