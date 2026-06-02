import { describe, it, expect } from "vitest";
import {
  calculateVirtualPool,
  getAmmDy,
  getDx,
  getDy,
  getEffectivePrice,
  isqrt,
  PRECISION,
  ROUNDING_DISCOUNT,
  type YieldBasisVirtualPoolParams,
} from "./yieldbasis";

describe("YieldBasis virtual pool math", () => {
  const params: YieldBasisVirtualPoolParams = {
    ammState: {
      collateral: 5000n * PRECISION,
      debt: 500000n * PRECISION,
      x0: 1100000n * PRECISION,
    },
    poolBalances: [1000000n * PRECISION, 500n * PRECISION],
    poolTotalSupply: 10000n * PRECISION,
    ammFee: 10n ** 15n,
  };

  describe("isqrt", () => {
    it("uses floor rounding", () => {
      expect(isqrt(0n)).toBe(0n);
      expect(isqrt(1n)).toBe(1n);
      expect(isqrt(15n)).toBe(3n);
      expect(isqrt(16n)).toBe(4n);
    });
  });

  describe("getAmmDy", () => {
    it("quotes stablecoin to LP collateral", () => {
      const dy = getAmmDy(params.ammState, params.ammFee, 0, 1, 10000n * PRECISION);
      expect(dy).toBe(81885245901639344261n);
    });

    it("quotes LP collateral to stablecoin", () => {
      const dy = getAmmDy(params.ammState, params.ammFee, 1, 0, 100n * PRECISION);
      expect(dy).toBe(11752941176470588235293n);
    });
  });

  describe("calculateVirtualPool", () => {
    it("matches the stablecoin to asset quadratic path", () => {
      const adjustedIn =
        (10000n * PRECISION * (PRECISION - ROUNDING_DISCOUNT)) / PRECISION;
      const result = calculateVirtualPool(params, 0, adjustedIn);

      expect(result.flashAmount).toBe(34458207280581751284651n);
      expect(result.outAmount).toBe(17229103640290875642n);
    });

    it("matches the asset to stablecoin LP path", () => {
      const result = calculateVirtualPool(params, 1, 5n * PRECISION);

      expect(result.flashAmount).toBe(10000n * PRECISION);
      expect(result.outAmount).toBe(1752941176470588235293n);
    });
  });

  describe("getDy", () => {
    it("applies the stablecoin-side rounding discount", () => {
      const dy = getDy(params, 0, 1, 10000n * PRECISION);
      expect(dy).toBe(17229103640290875642n);
    });

    it("quotes asset to stablecoin without applying the rounding discount", () => {
      const dy = getDy(params, 1, 0, 5n * PRECISION);
      expect(dy).toBe(1752941176470588235293n);
    });

    it("returns zero for invalid directions", () => {
      expect(getDy(params, 0, 0, PRECISION)).toBe(0n);
      expect(getDy(params, 2, 0, PRECISION)).toBe(0n);
    });
  });

  describe("getDx", () => {
    it("finds the minimum stablecoin input for a target asset output", () => {
      const target = getDy(params, 0, 1, 10000n * PRECISION);
      const dx = getDx(params, 0, 1, target);

      expect(dx).toBe(9999999999999999999749n);
      expect(getDy(params, 0, 1, dx)).toBeGreaterThanOrEqual(target);
      expect(getDy(params, 0, 1, dx - 1n)).toBeLessThan(target);
    });

    it("finds the minimum asset input for a target stablecoin output", () => {
      const target = getDy(params, 1, 0, 5n * PRECISION);
      const dx = getDx(params, 1, 0, target);

      expect(dx).toBe(5n * PRECISION);
      expect(getDy(params, 1, 0, dx)).toBeGreaterThanOrEqual(target);
      expect(getDy(params, 1, 0, dx - 1n)).toBeLessThan(target);
    });
  });

  describe("getEffectivePrice", () => {
    it("returns output per input in 1e18 precision", () => {
      const price = getEffectivePrice(params, 0, 1, 10000n * PRECISION);
      expect(price).toBe(1722910364029087n);
    });
  });

  describe("unprofitable virtual path", () => {
    it("throws when AMM output does not cover the flash amount", () => {
      const unprofitableParams: YieldBasisVirtualPoolParams = {
        ...params,
        ammState: {
          ...params.ammState,
          x0: 1000000n * PRECISION,
        },
      };

      expect(() =>
        calculateVirtualPool(unprofitableParams, 1, 5n * PRECISION)
      ).toThrow("AMM output is below flash amount");
    });
  });
});
