// The lead's decision has to survive being written by a model: fenced or not, percentage or
// fraction, with an example block before the real one, and with one broken row among good ones.
import { describe, it, expect } from "vitest";
import { parseDecisions, LOW_CONFIDENCE, DECISION_FORMAT } from "../src/office/decisions.js";

const block = (body: string) => "Here is my approach.\n\n```json\n" + body + "\n```";

describe("lead decisions", () => {
  it("reads owners, tasks and confidence out of the block the lead was asked for", () => {
    const decisions = parseDecisions(block(JSON.stringify({
      tasks: [
        { owner: "Maya", task: "Add the /healthz route", done: "curl returns 200 with uptime", confidence: 0.9 },
        { owner: "Leo", task: "Cover it with a test", done: "vitest passes", confidence: 0.4 },
      ],
      needs: ["a staging URL to point the check at"],
    })));
    expect(decisions?.tasks.map((task) => [task.owner, task.confidence])).toEqual([["Maya", 0.9], ["Leo", 0.4]]);
    expect(decisions?.tasks[0].done).toBe("curl returns 200 with uptime");
    expect(decisions?.needs).toEqual(["a staging URL to point the check at"]);
    // The low one is the task an operator should look at first, so it stays readable as low.
    expect(decisions!.tasks[1].confidence).toBeLessThan(LOW_CONFIDENCE);
  });

  it("reads a percentage as a percentage, and an unreadable confidence as no opinion", () => {
    const decisions = parseDecisions(block(JSON.stringify({
      tasks: [
        { owner: "Maya", task: "a", confidence: 80 },
        { owner: "Leo", task: "b", confidence: "high" },
        { owner: "Zoe", task: "c" },
        { owner: "Kai", task: "d", confidence: 2.4 },
      ],
    })));
    // 0.5 rather than 1 for the missing one: treating no answer as certainty cannot be
    // recovered from. And 0.5 rather than 0.024 for the 2.4: reading an incoherent number as a
    // percentage would flag a decision as a guess when nothing said it was, and this number's
    // only job is deciding which calls an operator looks at first.
    expect(decisions?.tasks.map((task) => task.confidence)).toEqual([0.8, 0.5, 0.5, 0.5]);
  });

  it("keeps the good rows when one is broken, and takes the real block over an example", () => {
    const answer = [
      "For example you might write:",
      "```json",
      '{"tasks":[{"owner":"<name>","task":"<task>"}]}',
      "```",
      "My actual decision:",
      "```json",
      '{"tasks":[{"owner":"Maya","task":"Ship it"},{"owner":"","task":"no owner"},{"task":"no owner key"}]}',
      "```",
    ].join("\n");
    const decisions = parseDecisions(answer);
    // The last block that parses wins, and a row missing either half is dropped rather than
    // half-invented.
    expect(decisions?.tasks).toHaveLength(1);
    expect(decisions?.tasks[0]).toMatchObject({ owner: "Maya", task: "Ship it" });
  });

  it("accepts the shapes a model reaches for instead of the one it was given", () => {
    const viaAliases = parseDecisions(block(JSON.stringify({
      tasks: [{ assignee: "Maya", title: "Ship it", acceptance: "tests pass" }],
    })));
    expect(viaAliases?.tasks[0]).toMatchObject({ owner: "Maya", task: "Ship it", done: "tests pass" });
    // A bare array of tasks, with no wrapper object.
    const bare = parseDecisions(block(JSON.stringify([{ owner: "Leo", task: "Do the thing" }])));
    expect(bare?.tasks[0]?.owner).toBe("Leo");
  });

  it("returns nothing to act on rather than throwing, so prose still degrades to the old path", () => {
    expect(parseDecisions("")).toBeNull();
    expect(parseDecisions("Just an approach, written as prose.")).toBeNull();
    expect(parseDecisions("```json\n{not json\n```")).toBeNull();
    // A block that parses but holds no usable decision is not a decision.
    expect(parseDecisions(block('{"tasks":[]}'))).toBeNull();
    expect(parseDecisions(block('{"notes":"none"}'))).toBeNull();
  });

  it("asks for reasoning as well as the block, so a lead does not stop explaining itself", () => {
    expect(DECISION_FORMAT).toContain("as well as your reasoning");
    expect(DECISION_FORMAT).toContain("confidence");
  });
});
