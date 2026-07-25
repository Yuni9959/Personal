import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mensaRoot = path.resolve(here, "..");
const dataRoot = path.join(mensaRoot, "data");
const sourceRoot = path.join(dataRoot, "sources");
const manifest = JSON.parse(fs.readFileSync(
  path.join(sourceRoot, "mkat-original-300-v1.manifest.json"),
  "utf8"
));
const compressedSource = fs.readFileSync(
  path.join(sourceRoot, manifest.storedFileName)
);
const originalBytes = zlib.gunzipSync(compressedSource);
const original300 = JSON.parse(originalBytes.toString("utf8"));
const advancedBytes = fs.readFileSync(
  path.join(dataRoot, "advanced-question-bank-v1.json")
);
const advanced = JSON.parse(advancedBytes.toString("utf8"));
const bank = JSON.parse(fs.readFileSync(
  path.join(dataRoot, "question-bank.json"),
  "utf8"
));

const ADVANCED_SHA256 =
  "1e7c4ce581dc26c044a5de06b8a446512e2bce9c206b230058d97f645d1d7dff";
const RETIRED_DUPLICATES = new Map([
  ["T03-10", "T03-06"],
  ["T03-11", "T03-07"],
  ["T03-14", "T03-06"],
  ["T08-15", "T08-11"],
  ["T18-12", "T18-06"],
  ["T18-13", "T18-07"],
  ["T18-14", "T18-08"],
  ["T18-15", "T18-09"]
]);
const UNSAFE_SVG = [
  /<\s*script\b/i,
  /<\s*foreignObject\b/i,
  /<\s*iframe\b/i,
  /\son[a-z]+\s*=/i,
  /javascript\s*:/i,
  /\b(?:href|xlink:href)\s*=\s*["'](?:https?:|\/\/)/i
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function countBy(items, key) {
  return Object.fromEntries([...items.reduce((counts, item) => {
    const value = String(key(item));
    counts.set(value, (counts.get(value) || 0) + 1);
    return counts;
  }, new Map())].sort(([left], [right]) =>
    left.localeCompare(right, "en", { numeric: true })
  ));
}

function optionKey(option) {
  return JSON.stringify({
    text: option.text ?? null,
    svg: option.svg ?? null,
    suffix: option.suffix ?? null
  });
}

function substantiveKey(question) {
  return sha256(JSON.stringify({
    typeId: question.typeId,
    prompt: question.prompt,
    stimulusSvg: question.typeId === "T24"
      ? null
      : question.stimulusSvg.replace(/\s+/g, " ").trim(),
    options: question.typeId === "T24"
      ? question.options.map(optionKey).sort()
      : null,
    correct: optionKey(question.options[question.answerIndex])
  }));
}

function duplicateGroups(questions) {
  const groups = new Map();
  for (const question of questions) {
    const key = substantiveKey(question);
    groups.set(key, [...(groups.get(key) || []), question.id]);
  }
  return [...groups.values()]
    .filter(ids => ids.length > 1)
    .map(ids => ids.sort())
    .sort((left, right) => left[0].localeCompare(right[0], "en"));
}

function answerText(question) {
  return String(question.options[question.answerIndex].text);
}

function numericAnswer(question) {
  return Number(answerText(question).replaceAll(",", ""));
}

function parseAttributes(source) {
  return Object.fromEntries(
    [...source.matchAll(/([:\w-]+)="([^"]*)"/g)]
      .map(match => [match[1], match[2]])
  );
}

function parseCubeNet(svg) {
  const cells = [...svg.matchAll(/<rect\b([^>]*)>/g)]
    .map(match => parseAttributes(match[1]))
    .filter(attributes => {
      const width = Number(attributes.width);
      const height = Number(attributes.height);
      return Number.isFinite(Number(attributes.x)) &&
        Number.isFinite(Number(attributes.y)) &&
        Number.isFinite(width) &&
        Math.abs(width - height) < 0.2 &&
        width < 100;
    })
    .map(attributes => ({
      x: Number(attributes.x),
      y: Number(attributes.y),
      size: Number(attributes.width)
    }));
  assert.equal(cells.length, 6, "전개도는 정사각형 6칸이어야 합니다.");
  const unit = cells.reduce((sum, cell) => sum + cell.size, 0) / cells.length;
  const minX = Math.min(...cells.map(cell => cell.x));
  const minY = Math.min(...cells.map(cell => cell.y));
  const normalized = cells.map(cell => [
    Math.round((cell.x - minX) / unit),
    Math.round((cell.y - minY) / unit)
  ]);
  assert.equal(new Set(normalized.map(cell => cell.join(","))).size, 6);
  return normalized;
}

function negate(vector) {
  return vector.map(value => -value);
}

function orientationKey(orientation) {
  return orientation.flat().join(",");
}

function foldOrientation(orientation, dx, dy) {
  const [right, down, normal] = orientation;
  if (dx === 1) return [negate(normal), down, right];
  if (dx === -1) return [normal, down, negate(right)];
  if (dy === 1) return [right, negate(normal), down];
  return [right, normal, negate(down)];
}

function isCubeNet(cells) {
  const cellSet = new Set(cells.map(cell => cell.join(",")));
  const queue = [cells[0]];
  const orientations = new Map([
    [cells[0].join(","), [[1, 0, 0], [0, 1, 0], [0, 0, 1]]]
  ]);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length) {
    const [x, y] = queue.shift();
    const orientation = orientations.get(`${x},${y}`);
    for (const [dx, dy] of directions) {
      const neighborKey = `${x + dx},${y + dy}`;
      if (!cellSet.has(neighborKey)) continue;
      const next = foldOrientation(orientation, dx, dy);
      if (orientations.has(neighborKey)) {
        if (orientationKey(orientations.get(neighborKey)) !==
            orientationKey(next)) {
          return false;
        }
      } else {
        orientations.set(neighborKey, next);
        queue.push([x + dx, y + dy]);
      }
    }
  }
  if (orientations.size !== 6) return false;
  return new Set(
    [...orientations.values()].map(orientation => orientation[2].join(","))
  ).size === 6;
}

function independentCubeValidity(question) {
  return question.options.map(option => isCubeNet(parseCubeNet(option.svg)));
}

function shiftCharacter(character, amount) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return alphabet[
    (alphabet.indexOf(character) + amount + alphabet.length * 2) %
    alphabet.length
  ];
}

function applyStringTransform(source, template, params) {
  const characters = [...source];
  if (template === 0) {
    return characters.reverse()
      .map(character => shiftCharacter(character, params.k))
      .join("");
  }
  if (template === 1) {
    return params.perm
      .map((sourceIndex, index) =>
        shiftCharacter(characters[sourceIndex], params.offs[index])
      )
      .join("");
  }
  if (template === 2) {
    const rotated = [
      ...characters.slice(params.r),
      ...characters.slice(0, params.r)
    ];
    return rotated.map((character, index) =>
      shiftCharacter(character, index % 2 ? -params.b : params.a)
    ).join("");
  }
  const permutation = [1, 0, 3, 2];
  return permutation.map((sourceIndex, index) =>
    shiftCharacter(characters[sourceIndex], params.offs[index])
  ).join("");
}

function arithmeticFormula(name, a, b, c) {
  const formulas = {
    "a×b+c": () => a * b + c,
    "a×b−c": () => a * b - c,
    "(a+b)×c": () => (a + b) * c,
    "a+b×c": () => a + b * c,
    "a²+b−c": () => a * a + b - c,
    "(a−c)×b": () => (a - c) * b,
    "a×(b−c)": () => a * (b - c),
    "a×b+b+c": () => a * b + b + c
  };
  assert.ok(formulas[name], `알 수 없는 산술식: ${name}`);
  return formulas[name]();
}

function parseIconGroup(svg) {
  return {
    square: [...svg.matchAll(/<rect\b([^>]*)>/g)]
      .map(match => parseAttributes(match[1]))
      .filter(attributes => attributes.x != null).length,
    triangle: (svg.match(/<polygon\b/g) || []).length,
    circle: (svg.match(/<circle\b/g) || []).length
  };
}

test("신규 300 원본은 해시·분포·ID·보기·SVG 안전성 계약을 만족한다", () => {
  assert.equal(sha256(compressedSource), manifest.storedSha256);
  assert.equal(sha256(originalBytes), manifest.jsonSha256);
  assert.equal(sha256(advancedBytes), ADVANCED_SHA256);
  assert.equal(original300.questions.length, 300);
  assert.equal(original300.types.length, 25);
  assert.deepEqual(
    countBy(original300.questions, question => question.difficulty),
    { 3: 50, 4: 50, 5: 50, 6: 50, 7: 50, 8: 50 }
  );
  assert.deepEqual(
    countBy(original300.questions, question => question.options.length),
    { 6: 216, 8: 84 }
  );
  assert.equal(duplicateGroups(original300.questions).length, 0);

  const ids = new Set();
  for (const question of original300.questions) {
    assert.ok(!ids.has(question.id), question.id);
    ids.add(question.id);
    assert.notEqual(question.typeId, "T19");
    assert.equal(question.options[question.answerIndex].id,
      question.correctOptionId, question.id);
    assert.equal(
      new Set(question.options.map(optionKey)).size,
      question.options.length,
      question.id
    );
    assert.equal(question.validation.uniqueAnswer, true, question.id);
    const svgs = [
      question.stimulusSvg,
      ...question.options.filter(option => option.svg).map(option => option.svg)
    ];
    for (const svg of svgs) {
      assert.ok(svg.trimStart().startsWith("<svg"), question.id);
      assert.ok(svg.trimEnd().endsWith("</svg>"), question.id);
      for (const pattern of UNSAFE_SVG) {
        assert.doesNotMatch(svg, pattern, question.id);
      }
    }
  }
});

test("신규 수리·문자·개수 문항의 정답을 검증 메타데이터에서 재계산한다", () => {
  const questions = original300.questions;
  const expectedTextTypes = new Set([
    "T16", "T17", "T18", "T20", "T21", "T22", "T23", "T25", "T26"
  ]);
  for (const question of questions) {
    const validation = question.validation;
    if (expectedTextTypes.has(question.typeId)) {
      assert.equal(
        answerText(question),
        String(validation.expected),
        question.id
      );
    }
    if (question.typeId === "T01") {
      const expectedTilt = validation.leftWeight === validation.rightWeight
        ? "level"
        : validation.leftWeight > validation.rightWeight ? "left" : "right";
      assert.equal(validation.expectedTilt, expectedTilt, question.id);
    } else if (question.typeId === "T17") {
      for (const [a, b, c, result] of validation.knownRows) {
        assert.equal(
          arithmeticFormula(validation.formula, a, b, c),
          result,
          question.id
        );
      }
      assert.equal(
        arithmeticFormula(validation.formula, ...validation.inputs),
        validation.expected,
        question.id
      );
    } else if (question.typeId === "T18") {
      assert.equal(
        validation.baseMultiplier * 2 + validation.extra,
        validation.expected,
        question.id
      );
    } else if (question.typeId === "T20") {
      const v = validation;
      if (v.template === "future-ratio") {
        const younger = v.expected;
        assert.equal(
          younger + v.difference + v.years,
          v.ratio * (younger + v.years),
          question.id
        );
      } else if (v.template === "past-ratio") {
        const older = v.expected;
        const younger = older - v.difference;
        assert.equal(
          older - v.years,
          v.ratio * (younger - v.years),
          question.id
        );
      } else if (v.template === "sum-future-ratio") {
        const younger = v.expected;
        assert.equal(
          v.sum - younger + v.years,
          v.ratio * (younger + v.years),
          question.id
        );
      } else {
        assert.equal(
          v.ratio * v.pastYounger + v.years,
          v.expected,
          question.id
        );
      }
    } else if (question.typeId === "T21") {
      assert.equal(
        validation.rows * (validation.rows + 1) / 2 *
        validation.cols * (validation.cols + 1) / 2,
        validation.expected,
        question.id
      );
    } else if (question.typeId === "T22") {
      assert.equal(
        validation.allSides.filter(
          sides => sides === validation.targetSides
        ).length,
        validation.expected,
        question.id
      );
    } else if (question.typeId === "T25") {
      assert.equal(
        validation.levels *
        validation.rayCount * (validation.rayCount - 1) / 2,
        validation.expected,
        question.id
      );
    } else if (question.typeId === "T26") {
      assert.equal(
        applyStringTransform(
          validation.query,
          validation.template,
          validation.params
        ),
        validation.expected,
        question.id
      );
    }
  }
});

test("신규·심화 정육면체 전개도를 독립 3차원 방향 전파로 재판정한다", () => {
  const questions = [
    ...original300.questions,
    ...advanced.questions
  ].filter(question => question.typeId === "T24");

  const correctedSourceIds = [];
  for (const question of questions) {
    const independent = independentCubeValidity(question);
    const desired = question.validation.askInvalid ? false : true;
    assert.equal(
      independent.filter(value => value === desired).length,
      1,
      question.id
    );
    assert.equal(independent[question.answerIndex], desired, question.id);
    if (question.id.startsWith("T24-0") ||
        Number(question.id.split("-").at(-1)) <= 15) {
      assert.deepEqual(
        independent,
        question.validation.optionValidity,
        question.id
      );
    } else if (JSON.stringify(independent) !==
        JSON.stringify(question.validation.optionValidity)) {
      correctedSourceIds.push(question.id);
    }

    const merged = bank.questions.find(item => item.id === question.id);
    assert.ok(merged, question.id);
    assert.deepEqual(
      merged.validation.optionValidity,
      independent,
      `${question.id} 병합 검증값`
    );
  }
  assert.deepEqual(correctedSourceIds, [
    "T24-17", "T24-18", "T24-19", "T24-20", "T24-21",
    "T24-23", "T24-24", "T24-25", "T24-26", "T24-27"
  ]);
});

test("기존 심화 수리·개수 문항도 표시 정답과 산식을 독립 검산한다", () => {
  for (const question of advanced.questions) {
    const validation = question.validation;
    if (["T16", "T17", "T20", "T21", "T22", "T25"]
      .includes(question.typeId)) {
      assert.equal(
        numericAnswer(question),
        Number(validation.expected),
        question.id
      );
    }
    if (question.typeId === "T21") {
      const { rows, cols, marked } = validation;
      const all = rows * (rows + 1) / 2 * cols * (cols + 1) / 2;
      let expected = all;
      if (validation.method === "marked") {
        const [row, col] = marked;
        expected = (row + 1) * (rows - row) *
          (col + 1) * (cols - col);
      } else if (validation.method === "nonsquare") {
        const squares = Array.from(
          { length: Math.min(rows, cols) },
          (_, index) => (rows - index) * (cols - index)
        ).reduce((sum, count) => sum + count, 0);
        expected = all - squares;
      }
      assert.equal(validation.expected, expected, question.id);
    } else if (question.typeId === "T22") {
      assert.equal(
        validation.allSides.filter(
          sides => sides === validation.targetSides
        ).length,
        validation.expected,
        question.id
      );
    } else if (question.typeId === "T23") {
      assert.deepEqual(
        answerText(question).split(/\s*(?:→|-)\s*/),
        validation.actualColors,
        question.id
      );
    } else if (question.typeId === "T25") {
      assert.equal(
        validation.horizontalLevels *
        validation.rayCount * (validation.rayCount - 1) / 2,
        validation.expected,
        question.id
      );
    } else if (question.typeId === "T18") {
      const optionWeights = question.options.map(option => {
        const group = parseIconGroup(option.svg);
        return Object.entries(group).reduce(
          (sum, [kind, count]) =>
            sum + count * validation.weights[kind],
          0
        );
      });
      assert.deepEqual(
        optionWeights
          .map((weight, index) => weight === validation.targetWeight
            ? index
            : null)
          .filter(index => index != null),
        [question.answerIndex],
        question.id
      );
    }
  }
});

test("심화 원본의 실질 중복 8개만 폐기하고 최종 652문항에는 중복이 없다", () => {
  const advancedActiveCandidates = advanced.questions.filter(
    question => question.typeId !== "T19"
  );
  const groups = duplicateGroups(advancedActiveCandidates);
  const duplicateIds = groups.flatMap(ids => ids.slice(1));
  assert.deepEqual(
    [...duplicateIds].sort(),
    [...RETIRED_DUPLICATES.keys()].sort()
  );
  for (const [duplicateId, originalId] of RETIRED_DUPLICATES) {
    const group = groups.find(ids =>
      ids.includes(duplicateId) && ids.includes(originalId)
    );
    assert.ok(group, `${duplicateId} → ${originalId}`);
  }

  assert.equal(bank.questions.length, 652);
  assert.equal(duplicateGroups(bank.questions).length, 0);
  assert.equal(bank.questions.some(question => question.typeId === "T19"), false);
  const finalIds = new Set(bank.questions.map(question => question.id));
  for (const question of original300.questions) {
    assert.ok(finalIds.has(question.id), question.id);
  }
  for (const question of advancedActiveCandidates) {
    assert.equal(
      finalIds.has(question.id),
      !RETIRED_DUPLICATES.has(question.id),
      question.id
    );
  }
  assert.deepEqual(
    new Map(bank.retiredQuestions.map(item => [item.id, item.duplicateOf])),
    RETIRED_DUPLICATES
  );
});
