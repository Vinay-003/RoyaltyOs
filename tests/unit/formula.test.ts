import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFormula, validateFormulaSyntax } from "../../packages/core/formula.ts";

test("formula: basic arithmetic evaluation", () => {
  assert.equal(evaluateFormula("100 + 50"), 150);
  assert.equal(evaluateFormula("100 - 30"), 70);
  assert.equal(evaluateFormula("25 * 4"), 100);
  assert.equal(evaluateFormula("100 / 4"), 25);
  assert.equal(evaluateFormula("(10 + 5) * 2"), 30);
});

test("formula: variables and functions", () => {
  const ctx = {
    revenue: 100000,
    net_revenue: 80000,
    cumulative_revenue: 500000,
    recoupment_remaining: 15000,
  };

  // 15% of net revenue
  assert.equal(evaluateFormula("net_revenue * 0.15", ctx), 12000);

  // min(recoupment_remaining, net_revenue * 0.5)
  assert.equal(evaluateFormula("min(recoupment_remaining, net_revenue * 0.5)", ctx), 15000);

  // max floor guarantee of 20000
  assert.equal(evaluateFormula("max(20000, net_revenue * 0.15)", ctx), 20000);

  // if condition on cumulative revenue
  assert.equal(
    evaluateFormula("if(cumulative_revenue >= 500000, revenue * 0.20, revenue * 0.10)", ctx),
    20000
  );
});

test("formula: syntax validation", () => {
  assert.equal(validateFormulaSyntax("revenue * 0.15").valid, true);
  assert.equal(validateFormulaSyntax("max(5000, net_revenue * 0.2)").valid, true);
  assert.equal(validateFormulaSyntax("if(revenue > 1000, 50, 20)").valid, true);
  assert.equal(validateFormulaSyntax("").valid, false);
  assert.equal(validateFormulaSyntax("revenue * (").valid, false);
});
