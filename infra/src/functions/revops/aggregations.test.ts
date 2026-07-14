import { describe, expect, it } from "vitest";
import {
  computeOpenPipelineValue,
  computePipelineCoverageRatio,
  computeWinRatePct,
  deriveDefaultPeriodTarget,
  normalizeHealthDistribution,
  toCents,
} from "./aggregations";

describe("computeWinRatePct", () => {
  it("computes won / (won + lost) as a percentage", () => {
    expect(computeWinRatePct(3, 1)).toBe(75);
  });

  it("returns 0 when there are no closed deals (no divide-by-zero)", () => {
    expect(computeWinRatePct(0, 0)).toBe(0);
  });

  it("returns 100 when nothing was lost", () => {
    expect(computeWinRatePct(5, 0)).toBe(100);
  });

  it("rounds to one decimal place", () => {
    // 1 / 3 = 33.333... -> 33.3
    expect(computeWinRatePct(1, 2)).toBe(33.3);
  });
});

describe("computeOpenPipelineValue", () => {
  it("subtracts closed won + lost from total", () => {
    expect(computeOpenPipelineValue(1000, 300, 200)).toBe(500);
  });

  it("floors at 0 (never negative)", () => {
    expect(computeOpenPipelineValue(100, 80, 80)).toBe(0);
  });
});

describe("deriveDefaultPeriodTarget", () => {
  it("uses closed-won run-rate * multiplier when there are wins", () => {
    expect(deriveDefaultPeriodTarget(100, 500, 3)).toBe(300);
  });

  it("falls back to open pipeline when nothing has closed", () => {
    expect(deriveDefaultPeriodTarget(0, 500, 3)).toBe(500);
  });

  it("returns 0 when there is no data", () => {
    expect(deriveDefaultPeriodTarget(0, 0, 3)).toBe(0);
  });
});

describe("computePipelineCoverageRatio", () => {
  it("computes open / target rounded to 2 decimals", () => {
    expect(computePipelineCoverageRatio(900, 300)).toBe(3);
    expect(computePipelineCoverageRatio(1000, 300)).toBe(3.33);
  });

  it("returns 0 when target is non-positive", () => {
    expect(computePipelineCoverageRatio(900, 0)).toBe(0);
  });
});

describe("toCents", () => {
  it("converts dollars to integer cents", () => {
    expect(toCents(12.34)).toBe(1234);
  });

  it("guards non-finite input", () => {
    expect(toCents(NaN)).toBe(0);
  });
});

describe("normalizeHealthDistribution", () => {
  it("fills missing colors with 0", () => {
    expect(normalizeHealthDistribution({ GREEN: 2 })).toEqual({
      GREEN: 2,
      YELLOW: 0,
      ORANGE: 0,
      RED: 0,
    });
  });
});
