// Regression: MGR-2 — Turbopack HMR doesn't hoist function declarations; helpers must precede the component that uses them.
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

const SRC = resolve(__dirname, "../recipe-editor-page.tsx");
const SIDEBAR_SRC = resolve(__dirname, "../recipe-sidebar.tsx");

function indexOfDeclaration(source: string, name: string): number {
  const match = source.match(new RegExp(`function ${name}[(<]`));
  return match?.index ?? -1;
}

describe("recipe-editor-page helper definition order (MGR-2 regression)", () => {
  const source = readFileSync(SRC, "utf-8");
  const mainIdx = indexOfDeclaration(source, "RecipeEditorPage");

  it("RecipeEditorPage is found in the file", () => {
    expect(mainIdx).toBeGreaterThan(-1);
  });

  it("SaveAllButton is defined before RecipeEditorPage", () => {
    const idx = indexOfDeclaration(source, "SaveAllButton");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(mainIdx);
  });

  it("MobileEstimatesBar is defined before RecipeEditorPage", () => {
    const idx = indexOfDeclaration(source, "MobileEstimatesBar");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(mainIdx);
  });

  it("RecipeEditorSkeleton is defined before RecipeEditorPage", () => {
    const idx = indexOfDeclaration(source, "RecipeEditorSkeleton");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(mainIdx);
  });
});

describe("recipe-sidebar helper definition order (same pattern)", () => {
  const source = readFileSync(SIDEBAR_SRC, "utf-8");
  const mainIdx = indexOfDeclaration(source, "RecipeSidebar");

  it("RecipeSidebar is found in the file", () => {
    expect(mainIdx).toBeGreaterThan(-1);
  });

  it("EstimateCard is defined before RecipeSidebar", () => {
    const idx = indexOfDeclaration(source, "EstimateCard");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(mainIdx);
  });

  it("SummaryRow is defined before RecipeSidebar", () => {
    const idx = indexOfDeclaration(source, "SummaryRow");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(mainIdx);
  });

  it("formatNum is defined before RecipeSidebar", () => {
    const idx = indexOfDeclaration(source, "formatNum");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(mainIdx);
  });

  it("formatGrainWeight is defined before RecipeSidebar", () => {
    const idx = indexOfDeclaration(source, "formatGrainWeight");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(mainIdx);
  });

  it("formatHopWeight is defined before RecipeSidebar", () => {
    const idx = indexOfDeclaration(source, "formatHopWeight");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(mainIdx);
  });

  it("bagLabel is defined before RecipeSidebar", () => {
    const idx = indexOfDeclaration(source, "bagLabel");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(mainIdx);
  });
});
