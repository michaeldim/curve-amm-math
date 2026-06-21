import { describe, expect, it } from "vitest";
import {
  computeMaxOracleDnPow,
  getDx,
  getDy,
  getDynamicFee,
  getEffectivePrice,
  getY0,
  isqrt,
  quote,
  quoteExactOut,
  PRECISION,
  type LlamaLendAmmParams,
} from "./llamalend";

describe("LlamaLend LLAMMA math", () => {
  const baseParams: LlamaLendAmmParams = {
    A: 100n,
    fee: 6n * 10n ** 15n,
    activeBand: 0,
    minBand: -1,
    maxBand: 1,
    pOracle: 2000n * PRECISION,
    pOracleUp: 2000n * PRECISION,
    bandsX: {
      [-1]: 25000n * PRECISION,
      0: 0n,
      1: 0n,
    },
    bandsY: {
      [-1]: 0n,
      0: 10n * PRECISION,
      1: 8n * PRECISION,
    },
  };

  describe("helpers", () => {
    it("computes floor square roots", () => {
      expect(isqrt(0n)).toBe(0n);
      expect(isqrt(1n)).toBe(1n);
      expect(isqrt(15n)).toBe(3n);
      expect(isqrt(16n)).toBe(4n);
    });

    it("computes the 50-band oracle distance limit", () => {
      const pow = computeMaxOracleDnPow(100n);
      expect(pow).toBeGreaterThan(PRECISION);
      expect(pow).toBeLessThan(2n * PRECISION);
    });

    it("calculates y0 for one-sided and mixed bands", () => {
      const yOnly = getY0(
        baseParams.A,
        0n,
        10n * PRECISION,
        baseParams.pOracle,
        baseParams.pOracleUp
      );
      const mixed = getY0(
        baseParams.A,
        1000n * PRECISION,
        10n * PRECISION,
        baseParams.pOracle,
        baseParams.pOracleUp
      );

      expect(yOnly).toBe(10n * PRECISION);
      expect(mixed).toBeGreaterThan(yOnly);
    });

    it("returns zero dynamic fee when oracle is inside the band", () => {
      expect(getDynamicFee(100n, baseParams.pOracle, baseParams.pOracleUp)).toBe(0n);
    });
  });

  describe("getDy", () => {
    it("quotes borrowed token to collateral through y bands", () => {
      const dy = getDy(baseParams, 0, 1, 1000n * PRECISION);

      expect(dy).toBeGreaterThan(0n);
      expect(dy).toBeLessThan(10n * PRECISION);

      const detailed = quote(baseParams, 0, 1, 1000n * PRECISION);
      expect(detailed.inAmount).toBe(1000n * PRECISION);
      expect(detailed.outAmount).toBe(dy);
      expect(detailed.n1).toBe(0);
      expect(detailed.n2).toBe(0);
    });

    it("can consume multiple y bands", () => {
      const detailed = quote(baseParams, 0, 1, 50000n * PRECISION);

      expect(detailed.outAmount).toBe(18n * PRECISION);
      expect(detailed.inAmount).toBeLessThan(50000n * PRECISION);
      expect(detailed.n1).toBe(0);
      expect(detailed.n2).toBe(1);
    });

    it("quotes collateral to borrowed token through x bands", () => {
      const dumpParams: LlamaLendAmmParams = {
        ...baseParams,
        activeBand: 0,
        bandsX: {
          [-1]: 12000n * PRECISION,
          0: 15000n * PRECISION,
          1: 0n,
        },
        bandsY: {
          [-1]: 0n,
          0: 0n,
          1: 0n,
        },
      };

      const dy = getDy(dumpParams, 1, 0, 1n * PRECISION);
      expect(dy).toBeGreaterThan(0n);
      expect(dy).toBeLessThan(15000n * PRECISION);
    });

    it("returns zero for invalid directions and zero input", () => {
      expect(getDy(baseParams, 0, 0, PRECISION)).toBe(0n);
      expect(getDy(baseParams, 2, 0, PRECISION)).toBe(0n);
      expect(getDy(baseParams, 0, 1, 0n)).toBe(0n);
    });
  });

  describe("getDx", () => {
    it("quotes exact output for borrowed token to collateral", () => {
      const target = getDy(baseParams, 0, 1, 1000n * PRECISION);
      const dx = getDx(baseParams, 0, 1, target);
      const detailed = quoteExactOut(baseParams, 0, 1, target);

      expect(dx).toBe(detailed.inAmount);
      expect(detailed.outAmount).toBe(target);
      const requote = getDy(baseParams, 0, 1, dx);
      const diff = requote > target ? requote - target : target - requote;
      expect(diff).toBeLessThanOrEqual(1n);
    });

    it("returns zero when exact output cannot be filled", () => {
      expect(getDx(baseParams, 0, 1, 100n * PRECISION)).toBe(0n);
    });
  });

  describe("getEffectivePrice", () => {
    it("returns output per input in 1e18 precision", () => {
      const price = getEffectivePrice(baseParams, 0, 1, 1000n * PRECISION);
      expect(price).toBeGreaterThan(0n);
    });
  });
});
