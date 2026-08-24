import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveStateToFile, loadStateFromFile } from "../src/storage.js";
import { createInitialState } from "../src/trading/engine.js";

test("state can be saved and loaded from disk", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fake-stock-"));
  const filePath = path.join(dir, "state.json");
  const state = createInitialState();
  state.price = 141.25;
  state.account.cashAvailable = 8750;

  saveStateToFile(filePath, state);
  const loaded = loadStateFromFile(filePath);

  assert.equal(loaded.price, 141.25);
  assert.equal(loaded.account.cashAvailable, 8750);
  assert.equal(loaded.symbol, "FAKE");

  rmSync(dir, { recursive: true, force: true });
});
