import assert from "node:assert/strict";
import test from "node:test";

import * as components from "../src/components.mjs";

const REQUIRED_COMPONENTS = [
  "addSlideBase",
  "addContentRail",
  "addWordmark",
  "addFooter",
  "addEditorialStatement",
  "addDecisionRoomTitle",
  "addMetric",
  "addCard",
  "addAnnotatedQuote",
  "addInsightBar",
  "addEvidenceBadge",
  "addSourceNote",
  "addChevronFlow",
  "addInputAnalysisOutput",
  "addCapabilityLayers",
  "addMatrix",
  "addComparison",
  "addTimeline",
  "addLadder",
  "addFunnel",
  "addDecisionTree",
  "addRoleMap",
  "addRiskRegister",
  "addHorizontalBars",
  "addSlopeChart",
  "addWaterfall",
  "addProgressRing",
  "addLineChart",
  "addRiskMatrix",
  "addStackedComposition",
  "addPriceScene",
  "addContactScene",
  "addConstructionDocumentVisual",
];

test("component library exposes every required reusable archetype", () => {
  for (const componentName of REQUIRED_COMPONENTS) {
    assert.equal(typeof components[componentName], "function", `${componentName} must be exported`);
  }
});

test("Cyrillic helper normalizes whitespace without changing Russian letters", () => {
  assert.equal(
    components.normalizeCyrillicText("  Решение\u00a0 по  объекту\nготово  "),
    "Решение по объекту\nготово",
  );
});

test("text guard is deterministic and reports overflow without shrinking below minimum", () => {
  const options = { width: 2.2, height: 0.55, fontSize: 18, minFontSize: 9, lineHeight: 1.15 };
  const shortResult = components.guardText("Короткий вывод", options);
  const longText = "Один объект существует в нескольких версиях документов ".repeat(12).trim();
  const first = components.guardText(longText, options);
  const second = components.guardText(longText, options);

  assert.deepEqual(first, second);
  assert.equal(shortResult.overflow, false);
  assert.equal(first.overflow, true);
  assert.equal(first.fontSize, 9);
  assert.ok(first.estimatedLines > first.maxLines);
  assert.throws(
    () => components.assertTextFits(longText, options),
    /Переполнение текста/,
  );
});
