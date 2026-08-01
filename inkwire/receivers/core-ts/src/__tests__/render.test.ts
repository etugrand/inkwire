import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../render.js";

describe("renderMarkdown", () => {
  it("renders markdown to html", () => {
    expect(renderMarkdown("# Hi")).toContain("<h1>Hi</h1>");
  });
  it("strips script tags and their contents", () => {
    const html = renderMarkdown("Hi\n\n<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(1)");
  });
  it("strips event handlers and javascript: urls", () => {
    const html = renderMarkdown('<a href="javascript:alert(1)" onclick="x()">z</a>');
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
  });
});
