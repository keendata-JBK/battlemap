import { describe, expect, it } from "vitest";
import { sortProjectLedger } from "./projectLedger.js";

describe("sortProjectLedger", () => {
  it("sorts by descending sales progress and keeps lost projects last", () => {
    const projects = [
      { id: "lead", stage: "lead", health: "green" },
      { id: "lost", stage: "lost", health: "green" },
      { id: "solution", stage: "solution", health: "green" },
      { id: "won", stage: "won", health: "green" },
      { id: "negotiation", stage: "negotiation", health: "green" },
      { id: "contract", stage: "contract", health: "green" },
      { id: "discovery", stage: "discovery", health: "green" },
    ];

    expect(sortProjectLedger(projects).map((project) => project.id)).toEqual([
      "won", "contract", "negotiation", "solution", "discovery", "lead", "lost",
    ]);
  });

  it("sorts the same stage by normal, attention, high-risk and paused health", () => {
    const projects = [
      { id: "paused", stage: "solution", health: "gray" },
      { id: "risk", stage: "solution", health: "red" },
      { id: "normal", stage: "solution", health: "green" },
      { id: "attention", stage: "solution", health: "yellow" },
    ];

    expect(sortProjectLedger(projects).map((project) => project.id)).toEqual([
      "normal", "attention", "risk", "paused",
    ]);
  });

  it("does not mutate the source array", () => {
    const projects = [
      { id: "lead", stage: "lead", health: "green" },
      { id: "won", stage: "won", health: "green" },
    ];

    sortProjectLedger(projects);
    expect(projects.map((project) => project.id)).toEqual(["lead", "won"]);
  });
});

