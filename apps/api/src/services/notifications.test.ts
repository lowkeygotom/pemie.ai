import assert from "node:assert/strict";
import test from "node:test";
import { env } from "../env.js";
import { storyAssignmentUrl } from "./notifications.js";

test("el enlace de asignación respeta el contrato del deep link de HU", () => {
  assert.equal(
    storyAssignmentUrl("acme", "pemie-ai", "PEM-38"),
    `${env.WEB_ORIGIN}/w/acme/p/pemie-ai?tab=stories&story=PEM-38`
  );
});
