/**
 * Unit tests for stableswap-exact module
 *
 * Tests exact precision StableSwap math that matches on-chain Vyper contracts.
 */
import { describe, it, expect } from "vitest";
import {
  getD,
  getY,
  getYD,
  getXp,
  getDyExact,
  getDxExact,
  dynamicFee,
  computeRates,
  computePrecisions,
  createExactParams,
  createExactParamsWithRates,
  A_PRECISION,
  FEE_DENOMINATOR,
  PRECISION,
  type ExactPoolParams,
} from "./stableswap-exact";

describe("StableSwap Exact Precision", () => {
  // Test parameters for a typical 2-coin pool (e.g., crvUSD/USDC)
  const decimals2 = [18, 6]; // 18 and 6 decimal tokens
  const rates2 = computeRates(decimals2);

  // 3pool style: DAI (18), USDC (6), USDT (6)
  const decimals3 = [18, 6, 6];
  const rates3 = computeRates(decimals3);

  describe("computeRates", () => {
    it("should compute rates as 10^(36 - decimals)", () => {
      expect(computeRates([18])).toEqual([10n ** 18n]);
      expect(computeRates([6])).toEqual([10n ** 30n]);
      expect(computeRates([8])).toEqual([10n ** 28n]);
      expect(computeRates([18, 6])).toEqual([10n ** 18n, 10n ** 30n]);
    });

    it("should handle various decimal combinations", () => {
      // DAI (18), USDC (6), USDT (6)
      const rates = computeRates([18, 6, 6]);
      expect(rates[0]).toBe(10n ** 18n);
      expect(rates[1]).toBe(10n ** 30n);
      expect(rates[2]).toBe(10n ** 30n);
    });

    it("should throw for decimals > 36", () => {
      expect(() => computeRates([37])).toThrow("decimals[0] = 37 exceeds maximum of 36");
      expect(() => computeRates([18, 40])).toThrow("decimals[1] = 40 exceeds maximum of 36");
    });

    it("should throw for negative decimals", () => {
      expect(() => computeRates([-1])).toThrow("decimals[0] = -1 cannot be negative");
      expect(() => computeRates([6, -5])).toThrow("decimals[1] = -5 cannot be negative");
    });

    it("should handle edge case of 0 decimals", () => {
      expect(computeRates([0])).toEqual([10n ** 36n]);
    });

    it("should handle edge case of 36 decimals", () => {
      expect(computeRates([36])).toEqual([1n]);
    });
  });

  describe("computePrecisions", () => {
    it("should compute precisions as 10^(18 - decimals)", () => {
      expect(computePrecisions([18])).toEqual([1n]);
      expect(computePrecisions([6])).toEqual([10n ** 12n]);
      expect(computePrecisions([8])).toEqual([10n ** 10n]);
    });

    it("should differ from rates by factor of 10^18", () => {
      const decimals = [18, 6, 8];
      const rates = computeRates(decimals);
      const precisions = computePrecisions(decimals);

      for (let i = 0; i < decimals.length; i++) {
        expect(rates[i]).toBe(precisions[i] * PRECISION);
      }
    });

    it("should throw for decimals > 18", () => {
      expect(() => computePrecisions([20])).toThrow("decimals[0] = 20 exceeds maximum of 18");
      expect(() => computePrecisions([18, 19])).toThrow("decimals[1] = 19 exceeds maximum of 18");
    });

    it("should throw for negative decimals", () => {
      expect(() => computePrecisions([-1])).toThrow("decimals[0] = -1 cannot be negative");
      expect(() => computePrecisions([6, -2])).toThrow("decimals[1] = -2 cannot be negative");
    });

    it("should handle edge case of 0 decimals", () => {
      expect(computePrecisions([0])).toEqual([10n ** 18n]);
    });
  });

  describe("getXp", () => {
    it("should normalize balances to 18 decimals", () => {
      // 1000 tokens of each
      const balances = [1000n * 10n ** 18n, 1000n * 10n ** 6n];
      const xp = getXp(balances, rates2);

      // Both should be ~1000 * 10^18 after normalization
      expect(xp[0]).toBe(1000n * 10n ** 18n);
      expect(xp[1]).toBe(1000n * 10n ** 18n);
    });

    it("should handle different decimal combinations", () => {
      // 3pool: DAI (18), USDC (6), USDT (6)
      const balances = [
        1000n * 10n ** 18n, // 1000 DAI
        1000n * 10n ** 6n, // 1000 USDC
        1000n * 10n ** 6n, // 1000 USDT
      ];
      const xp = getXp(balances, rates3);

      expect(xp[0]).toBe(1000n * 10n ** 18n);
      expect(xp[1]).toBe(1000n * 10n ** 18n);
      expect(xp[2]).toBe(1000n * 10n ** 18n);
    });
  });

  describe("getD", () => {
    it("should return 0 for empty pool", () => {
      const xp = [0n, 0n];
      const amp = 100n * A_PRECISION;
      expect(getD(xp, amp, 2)).toBe(0n);
    });

    it("should return sum for balanced pool with high A", () => {
      const balance = 1000n * 10n ** 18n;
      const xp = [balance, balance];
      const amp = 1000n * A_PRECISION; // High A = close to sum

      const D = getD(xp, amp, 2);
      // D should be very close to 2 * balance for high A
      expect(D).toBeGreaterThan(balance * 2n - 10n ** 15n);
      expect(D).toBeLessThanOrEqual(balance * 2n);
    });

    it("should handle imbalanced pools", () => {
      const xp = [1000n * 10n ** 18n, 1100n * 10n ** 18n];
      const amp = 100n * A_PRECISION;

      const D = getD(xp, amp, 2);
      // D should be between sum and geometric mean
      expect(D).toBeGreaterThan(2000n * 10n ** 18n);
      expect(D).toBeLessThan(2100n * 10n ** 18n);
    });

    it("should work with 3 coins", () => {
      const balance = 1000n * 10n ** 18n;
      const xp = [balance, balance, balance];
      const amp = 100n * A_PRECISION;

      const D = getD(xp, amp, 3);
      // D should be close to 3 * balance
      expect(D).toBeGreaterThan(balance * 3n - 10n ** 18n);
      expect(D).toBeLessThan(balance * 3n + 10n ** 18n);
    });

    it("should converge for extreme imbalance", () => {
      // 100:1 ratio
      const xp = [100n * 10n ** 18n, 1n * 10n ** 18n];
      const amp = 100n * A_PRECISION;

      const D = getD(xp, amp, 2);
      expect(D).toBeGreaterThan(0n);
      expect(D).toBeLessThan(101n * 10n ** 18n);
    });
  });

  describe("getY", () => {
    it("should maintain invariant", () => {
      const balance = 1000n * 10n ** 18n;
      const xp = [balance, balance];
      const amp = 100n * A_PRECISION;
      const D = getD(xp, amp, 2);

      const dx = 10n * 10n ** 18n;
      const newX = xp[0] + dx;
      const y = getY(0, 1, newX, xp, amp, D, 2);

      // y should be less than original xp[1]
      expect(y).toBeLessThan(xp[1]);
      // The reduction should be less than dx (stableswap property)
      expect(xp[1] - y).toBeLessThan(dx);
    });

    it("should handle swapping in opposite direction", () => {
      const xp = [1000n * 10n ** 18n, 1000n * 10n ** 18n];
      const amp = 100n * A_PRECISION;
      const D = getD(xp, amp, 2);

      const dx = 10n * 10n ** 18n;
      const newX = xp[1] + dx;
      const y = getY(1, 0, newX, xp, amp, D, 2);

      expect(y).toBeLessThan(xp[0]);
    });

    it("should work with 3 coins", () => {
      const balance = 1000n * 10n ** 18n;
      const xp = [balance, balance, balance];
      const amp = 100n * A_PRECISION;
      const D = getD(xp, amp, 3);

      const dx = 10n * 10n ** 18n;
      const newX = xp[0] + dx;
      const y = getY(0, 2, newX, xp, amp, D, 3);

      expect(y).toBeLessThan(xp[2]);
    });
  });

  describe("getYD", () => {
    it("should solve for Y given D", () => {
      const balance = 1000n * 10n ** 18n;
      const xp = [balance, balance];
      const amp = 100n * A_PRECISION;
      const D = getD(xp, amp, 2);

      // Solve for coin 1 given current D
      const y = getYD(amp, 1, xp, D, 2);

      // Should be close to original balance
      expect(y).toBeGreaterThan(balance - 10n ** 15n);
      expect(y).toBeLessThan(balance + 10n ** 15n);
    });

    it("should handle reduced D (withdrawal)", () => {
      const balance = 1000n * 10n ** 18n;
      const xp = [balance, balance];
      const amp = 100n * A_PRECISION;
      const D = getD(xp, amp, 2);

      // Reduce D by 10%
      const newD = (D * 90n) / 100n;
      const y = getYD(amp, 1, xp, newD, 2);

      // Y should be less than original
      expect(y).toBeLessThan(balance);
    });
  });

  describe("dynamicFee", () => {
    const baseFee = 4000000n; // 0.04%

    it("should return base fee when multiplier <= FEE_DENOMINATOR", () => {
      const fee = dynamicFee(100n, 100n, baseFee, FEE_DENOMINATOR);
      expect(fee).toBe(baseFee);
    });

    it("should return base fee when multiplier is 0", () => {
      const fee = dynamicFee(100n, 100n, baseFee, 0n);
      expect(fee).toBe(baseFee);
    });

    it("should increase fee for imbalanced pool", () => {
      const multiplier = 2n * FEE_DENOMINATOR;
      // Imbalanced: 100 vs 200
      const fee = dynamicFee(100n * 10n ** 18n, 200n * 10n ** 18n, baseFee, multiplier);

      // Fee should be higher than base fee
      expect(fee).toBeGreaterThan(baseFee);
      // But not more than multiplier * baseFee
      expect(fee).toBeLessThanOrEqual((baseFee * multiplier) / FEE_DENOMINATOR);
    });

    it("should return base fee for balanced pool with multiplier", () => {
      const multiplier = 2n * FEE_DENOMINATOR;
      const balance = 100n * 10n ** 18n;
      const fee = dynamicFee(balance, balance, baseFee, multiplier);

      // For perfectly balanced, fee should be close to base fee
      expect(fee).toBe(baseFee);
    });
  });

  describe("getDyExact", () => {
    it("should calculate swap output in native decimals", () => {
      // Pool with 1M of each token
      const params: ExactPoolParams = {
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 6n],
        rates: rates2,
        A: 100n,
        fee: 4000000n, // 0.04%
        offpegFeeMultiplier: 0n,
      };

      // Swap 1000 of token 0 (18 decimals)
      const dx = 1000n * 10n ** 18n;
      const dy = getDyExact(0, 1, dx, params);

      // Output should be in 6 decimals (token 1)
      // For balanced pool, should be close to 1000 * 10^6 minus fees
      expect(dy).toBeGreaterThan(990n * 10n ** 6n);
      expect(dy).toBeLessThan(1000n * 10n ** 6n);
    });

    it("should calculate swap in opposite direction", () => {
      const params: ExactPoolParams = {
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 6n],
        rates: rates2,
        A: 100n,
        fee: 4000000n,
        offpegFeeMultiplier: 0n,
      };

      // Swap 1000 of token 1 (6 decimals)
      const dx = 1000n * 10n ** 6n;
      const dy = getDyExact(1, 0, dx, params);

      // Output should be in 18 decimals (token 0)
      expect(dy).toBeGreaterThan(990n * 10n ** 18n);
      expect(dy).toBeLessThan(1000n * 10n ** 18n);
    });

    it("should apply dynamic fee for imbalanced pool", () => {
      // Imbalanced pool: 100:200 ratio
      const params: ExactPoolParams = {
        balances: [100n * 10n ** 18n, 200n * 10n ** 6n],
        rates: rates2,
        A: 100n,
        fee: 4000000n,
        offpegFeeMultiplier: 2n * FEE_DENOMINATOR,
      };

      const dx = 1n * 10n ** 18n;
      const dy = getDyExact(0, 1, dx, params);

      // Should get output (selling the scarcer token)
      expect(dy).toBeGreaterThan(0n);
    });

    it("should work with 3-coin pool", () => {
      const params: ExactPoolParams = {
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 6n, 1000000n * 10n ** 6n],
        rates: rates3,
        A: 100n,
        fee: 4000000n,
        offpegFeeMultiplier: 0n,
      };

      // DAI -> USDC
      const dy01 = getDyExact(0, 1, 1000n * 10n ** 18n, params);
      expect(dy01).toBeGreaterThan(990n * 10n ** 6n);

      // USDC -> USDT
      const dy12 = getDyExact(1, 2, 1000n * 10n ** 6n, params);
      expect(dy12).toBeGreaterThan(990n * 10n ** 6n);

      // DAI -> USDT
      const dy02 = getDyExact(0, 2, 1000n * 10n ** 18n, params);
      expect(dy02).toBeGreaterThan(990n * 10n ** 6n);
    });

    it("should handle very small swaps", () => {
      const params: ExactPoolParams = {
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 6n],
        rates: rates2,
        A: 100n,
        fee: 4000000n,
        offpegFeeMultiplier: 0n,
      };

      // Swap 1 wei of token 0
      const dy = getDyExact(0, 1, 1n, params);
      // Output might be 0 due to precision, but shouldn't throw
      expect(dy).toBeGreaterThanOrEqual(0n);
    });

    it("should handle large swaps", () => {
      const params: ExactPoolParams = {
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 6n],
        rates: rates2,
        A: 100n,
        fee: 4000000n,
        offpegFeeMultiplier: 0n,
      };

      // Swap 10% of pool
      const dx = 100000n * 10n ** 18n;
      const dy = getDyExact(0, 1, dx, params);

      // Should get less than input due to slippage
      expect(dy).toBeGreaterThan(90000n * 10n ** 6n);
      expect(dy).toBeLessThan(100000n * 10n ** 6n);
    });
  });

  describe("getDxExact", () => {
    it("should calculate required input for desired output", () => {
      const params: ExactPoolParams = {
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 6n],
        rates: rates2,
        A: 100n,
        fee: 4000000n,
        offpegFeeMultiplier: 0n,
      };

      // Want 1000 of token 1 (6 decimals)
      const desiredDy = 1000n * 10n ** 6n;
      const dx = getDxExact(0, 1, desiredDy, params);

      // Required input should be slightly more than output (due to fees)
      expect(dx).toBeGreaterThan(1000n * 10n ** 18n);
      expect(dx).toBeLessThan(1010n * 10n ** 18n);
    });

    it("should be inverse of getDyExact approximately", () => {
      const params: ExactPoolParams = {
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 6n],
        rates: rates2,
        A: 100n,
        fee: 4000000n,
        offpegFeeMultiplier: 0n,
      };

      // Calculate dx for desired dy
      const desiredDy = 1000n * 10n ** 6n;
      const dx = getDxExact(0, 1, desiredDy, params);

      // Verify: getDy(dx) should give approximately desiredDy
      const actualDy = getDyExact(0, 1, dx, params);

      // Should be within 0.1% of desired
      const diff = actualDy > desiredDy ? actualDy - desiredDy : desiredDy - actualDy;
      const tolerance = desiredDy / 1000n;
      expect(diff).toBeLessThanOrEqual(tolerance);
    });
  });

  describe("createExactParams", () => {
    it("should create params with computed rates", () => {
      const balances = [1000n * 10n ** 18n, 1000n * 10n ** 6n];
      const decimals = [18, 6];

      const params = createExactParams(balances, decimals, 100n, 4000000n);

      expect(params.balances).toEqual(balances);
      expect(params.rates).toEqual(computeRates(decimals));
      expect(params.A).toBe(100n);
      expect(params.fee).toBe(4000000n);
      expect(params.offpegFeeMultiplier).toBe(0n);
    });

    it("should handle optional offpegFeeMultiplier", () => {
      const params = createExactParams([100n, 100n], [18, 18], 100n, 4000000n, 2n * FEE_DENOMINATOR);

      expect(params.offpegFeeMultiplier).toBe(2n * FEE_DENOMINATOR);
    });
  });

  describe("createExactParamsWithRates", () => {
    it("should create params with custom rates", () => {
      const balances = [1000n * 10n ** 18n, 1000n * 10n ** 18n];
      const customRates = [10n ** 18n, 12n * 10n ** 17n]; // Second token has 1.2x rate

      const params = createExactParamsWithRates(balances, customRates, 100n, 4000000n);

      expect(params.rates).toEqual(customRates);
    });
  });

  describe("Edge Cases", () => {
    it("should handle same-decimal tokens", () => {
      const rates = computeRates([18, 18]);
      const params: ExactPoolParams = {
        balances: [1000n * 10n ** 18n, 1000n * 10n ** 18n],
        rates,
        A: 100n,
        fee: 4000000n,
        offpegFeeMultiplier: 0n,
      };

      const dy = getDyExact(0, 1, 10n * 10n ** 18n, params);
      // For same-decimal balanced pool, output should be close to input
      expect(dy).toBeGreaterThan(9n * 10n ** 18n);
      expect(dy).toBeLessThan(10n * 10n ** 18n);
    });

    it("should handle high A value", () => {
      const params: ExactPoolParams = {
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 6n],
        rates: rates2,
        A: 10000n, // Very high A
        fee: 4000000n,
        offpegFeeMultiplier: 0n,
      };

      const dy = getDyExact(0, 1, 1000n * 10n ** 18n, params);
      // High A should give better rate (closer to 1:1)
      expect(dy).toBeGreaterThan(995n * 10n ** 6n);
    });

    it("should handle low A value", () => {
      const params: ExactPoolParams = {
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 6n],
        rates: rates2,
        A: 10n, // Very low A
        fee: 4000000n,
        offpegFeeMultiplier: 0n,
      };

      const dy = getDyExact(0, 1, 1000n * 10n ** 18n, params);
      // Low A should give worse rate
      expect(dy).toBeGreaterThan(900n * 10n ** 6n);
      expect(dy).toBeLessThan(1000n * 10n ** 6n);
    });

    it("should handle zero fee", () => {
      const params: ExactPoolParams = {
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 6n],
        rates: rates2,
        A: 100n,
        fee: 0n,
        offpegFeeMultiplier: 0n,
      };

      const dy = getDyExact(0, 1, 1000n * 10n ** 18n, params);
      // With zero fee, output should be higher
      expect(dy).toBeGreaterThan(999n * 10n ** 6n);
    });

    it("should handle 8-coin pool", () => {
      const nCoins = 8;
      const decimals = Array(nCoins).fill(18);
      const rates = computeRates(decimals);
      const balance = 1000n * 10n ** 18n;

      const params: ExactPoolParams = {
        balances: Array(nCoins).fill(balance),
        rates,
        A: 100n,
        fee: 4000000n,
        offpegFeeMultiplier: 0n,
      };

      // Swap between first and last coin
      const dy = getDyExact(0, 7, 10n * 10n ** 18n, params);
      expect(dy).toBeGreaterThan(9n * 10n ** 18n);
    });
  });

  describe("Consistency with normalized approach", () => {
    it("should produce similar results to standard stableswap for simple cases", () => {
      // This test verifies the exact approach produces reasonable results
      // The exact approach may differ by a few units due to operation order
      const params: ExactPoolParams = {
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 18n], // Same decimals
        rates: computeRates([18, 18]),
        A: 100n,
        fee: 4000000n,
        offpegFeeMultiplier: 0n,
      };

      const dx = 1000n * 10n ** 18n;
      const dy = getDyExact(0, 1, dx, params);

      // For balanced same-decimal pool, output should be close to input minus fees
      const expectedApprox = dx - (dx * 4000000n) / FEE_DENOMINATOR;
      const diff = dy > expectedApprox ? dy - expectedApprox : expectedApprox - dy;

      // Should be within 1% of expected
      expect(diff).toBeLessThan(dx / 100n);
    });
  });
});
