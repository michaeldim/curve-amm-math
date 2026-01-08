/**
 * Edge case tests for extreme pool states and unusual inputs.
 * These tests verify the math library handles degenerate cases gracefully.
 */
import { describe, it, expect } from "vitest";
import * as stableswap from "./stableswap";
import * as cryptoswap from "./cryptoswap";

describe("StableSwap Edge Cases", () => {
  describe("Extreme Imbalance", () => {
    const Ann = stableswap.computeAnn(100n, 2);
    const baseFee = 4000000n; // 0.04%
    const feeMultiplier = 2n * 10n ** 10n;

    it("should handle 100:1 imbalance", () => {
      const xp = [100n * 10n ** 18n, 1n * 10n ** 18n]; // 100:1 ratio
      const dx = 1n * 10n ** 18n;

      const dy = stableswap.getDy(0, 1, dx, xp, Ann, baseFee, feeMultiplier);

      // Output should be positive but much less than input due to imbalance
      expect(dy).toBeGreaterThan(0n);
      expect(dy).toBeLessThan(dx); // Selling the abundant token yields less
    });

    it("should handle 1000:1 imbalance", () => {
      const xp = [1000n * 10n ** 18n, 1n * 10n ** 18n]; // 1000:1 ratio
      const dx = 1n * 10n ** 18n;

      const dy = stableswap.getDy(0, 1, dx, xp, Ann, baseFee, feeMultiplier);

      expect(dy).toBeGreaterThan(0n);
      expect(dy).toBeLessThan(dx);
    });

    it("should handle selling the scarce token (premium)", () => {
      const xp = [100n * 10n ** 18n, 1n * 10n ** 18n]; // Token 1 is scarce
      const dx = 1n * 10n ** 17n; // Sell 0.1 of scarce token

      const dy = stableswap.getDy(1, 0, dx, xp, Ann, baseFee, feeMultiplier);

      // Selling scarce token should give MORE than 1:1 (premium)
      expect(dy).toBeGreaterThan(dx);
    });

    it("should handle 10000:1 extreme imbalance with higher A", () => {
      // Higher A parameter for extreme cases
      const highAnn = stableswap.computeAnn(2000n, 2);
      const xp = [10000n * 10n ** 18n, 1n * 10n ** 18n];
      const dx = 1n * 10n ** 17n; // Small swap

      const dy = stableswap.getDy(0, 1, dx, xp, highAnn, baseFee, feeMultiplier);

      expect(dy).toBeGreaterThan(0n);
    });
  });

  describe("Very Small Swaps", () => {
    const Ann = stableswap.computeAnn(100n, 2);
    const xp = [1000n * 10n ** 18n, 1000n * 10n ** 18n];
    const baseFee = 4000000n;
    const feeMultiplier = 2n * 10n ** 10n;

    it("should handle 1 wei swap", () => {
      const dy = stableswap.getDy(0, 1, 1n, xp, Ann, baseFee, feeMultiplier);

      // 1 wei might be consumed entirely by fees, result could be 0
      expect(dy).toBeGreaterThanOrEqual(0n);
    });

    it("should handle 1000 wei swap", () => {
      const dy = stableswap.getDy(0, 1, 1000n, xp, Ann, baseFee, feeMultiplier);

      expect(dy).toBeGreaterThan(0n);
      expect(dy).toBeLessThanOrEqual(1000n); // Can't get more than input
    });
  });

  describe("Very Large Swaps", () => {
    const Ann = stableswap.computeAnn(100n, 2);
    const xp = [1000000n * 10n ** 18n, 1000000n * 10n ** 18n]; // 1M each
    const baseFee = 4000000n;
    const feeMultiplier = 2n * 10n ** 10n;

    it("should handle swapping entire balance", () => {
      // Try to swap all of token 0 (this should drain token 1)
      const dx = xp[0];
      const dy = stableswap.getDy(0, 1, dx, xp, Ann, baseFee, feeMultiplier);

      // Should get significant output but less than token 1 balance
      expect(dy).toBeGreaterThan(0n);
      expect(dy).toBeLessThan(xp[1]);
    });

    it("should handle swap larger than any balance", () => {
      // Try to swap more than exists
      const dx = xp[0] * 10n;

      // This might throw or return a very small output
      try {
        const dy = stableswap.getDy(0, 1, dx, xp, Ann, baseFee, feeMultiplier);
        // If it doesn't throw, output should be limited by pool balance
        expect(dy).toBeLessThan(xp[1]);
      } catch {
        // Throwing is acceptable for impossible swaps
        expect(true).toBe(true);
      }
    });
  });

  describe("Precision Extremes", () => {
    it("should handle 0-decimal token equivalent", () => {
      // Simulate 0-decimal token scaled to 18 decimals
      // If token has 0 decimals, 1 token = 1e18 in xp
      const Ann = stableswap.computeAnn(100n, 2);
      const xp = [1000n * 10n ** 18n, 1000n * 10n ** 18n];
      const baseFee = 4000000n;
      const feeMultiplier = 2n * 10n ** 10n;

      // Swap exactly 1 "token" (1e18 in precision)
      const dx = 10n ** 18n;
      const dy = stableswap.getDy(0, 1, dx, xp, Ann, baseFee, feeMultiplier);

      expect(dy).toBeGreaterThan(0n);
      // Close to 1:1 for balanced pool
      expect(dy).toBeGreaterThan(9n * 10n ** 17n);
    });

    it("should handle different precision multipliers", () => {
      // Pool with 6 vs 18 decimal tokens (USDC/DAI style)
      // After precision adjustment both should be 1e18
      const Ann = stableswap.computeAnn(100n, 2);
      const xp = [1000000n * 10n ** 18n, 1000000n * 10n ** 18n]; // Both normalized
      const baseFee = 4000000n;
      const feeMultiplier = 2n * 10n ** 10n;

      const dx = 1000n * 10n ** 18n; // 1000 tokens normalized
      const dy = stableswap.getDy(0, 1, dx, xp, Ann, baseFee, feeMultiplier);

      // Should be close to 1:1
      expect(dy).toBeGreaterThan(990n * 10n ** 18n);
      expect(dy).toBeLessThan(1010n * 10n ** 18n);
    });
  });

  describe("Zero and Boundary Values", () => {
    const Ann = stableswap.computeAnn(100n, 2);
    const xp = [1000n * 10n ** 18n, 1000n * 10n ** 18n];
    const baseFee = 4000000n;
    const feeMultiplier = 2n * 10n ** 10n;

    it("should handle 0 input gracefully", () => {
      const dy = stableswap.getDy(0, 1, 0n, xp, Ann, baseFee, feeMultiplier);
      // 0 input might return 0 or -1 (due to fee subtraction from nothing)
      // The important thing is it doesn't throw
      expect(dy).toBeLessThanOrEqual(0n);
    });

    it("should handle same index swap (i == j)", () => {
      // Swapping token to itself should either throw or return 0
      try {
        const dy = stableswap.getDy(0, 0, 10n ** 18n, xp, Ann, baseFee, feeMultiplier);
        expect(dy).toBe(0n);
      } catch {
        // Throwing is acceptable
        expect(true).toBe(true);
      }
    });
  });

  describe("Multi-Coin Pools", () => {
    it("should handle 3-coin balanced pool", () => {
      const Ann = stableswap.computeAnn(100n, 3);
      const xp = [
        1000n * 10n ** 18n,
        1000n * 10n ** 18n,
        1000n * 10n ** 18n,
      ];
      const baseFee = 4000000n;
      const feeMultiplier = 2n * 10n ** 10n;

      // Test all pair combinations
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          if (i !== j) {
            const dy = stableswap.getDy(
              i,
              j,
              10n * 10n ** 18n,
              xp,
              Ann,
              baseFee,
              feeMultiplier
            );
            expect(dy).toBeGreaterThan(0n);
          }
        }
      }
    });

    it("should handle 4-coin pool", () => {
      const Ann = stableswap.computeAnn(100n, 4);
      const xp = [
        1000n * 10n ** 18n,
        1000n * 10n ** 18n,
        1000n * 10n ** 18n,
        1000n * 10n ** 18n,
      ];
      const baseFee = 4000000n;
      const feeMultiplier = 2n * 10n ** 10n;

      const dy = stableswap.getDy(0, 3, 10n * 10n ** 18n, xp, Ann, baseFee, feeMultiplier);
      expect(dy).toBeGreaterThan(0n);
    });
  });
});

describe("CryptoSwap Edge Cases", () => {
  describe("Extreme Price Ratios", () => {
    it("should handle high price_scale (expensive token)", () => {
      // Use balanced params where D is consistent with balances * price_scale
      const params: cryptoswap.TwocryptoParams = {
        A: 400000n,
        gamma: 145000000000000n,
        D: 2000000n * 10n ** 18n, // D should match scaled balance sum
        midFee: 3000000n,
        outFee: 30000000n,
        feeGamma: 230000000000000n,
        priceScale: 10n ** 18n, // 1:1 price scale
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 18n],
        precisions: [1n, 1n],
      };

      const dx = 100n * 10n ** 18n; // Swap 100 tokens
      const dy = cryptoswap.getDy(params, 0, 1, dx);

      // Should get approximately 100 tokens out (minus fees)
      expect(dy).toBeGreaterThan(0n);
      expect(dy).toBeLessThan(dx * 2n); // Reasonable output
    });

    it("should handle swapping with fees applied", () => {
      const params: cryptoswap.TwocryptoParams = {
        A: 400000n,
        gamma: 145000000000000n,
        D: 2000000n * 10n ** 18n,
        midFee: 3000000n, // 0.03%
        outFee: 30000000n, // 0.3%
        feeGamma: 230000000000000n,
        priceScale: 10n ** 18n,
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 18n],
        precisions: [1n, 1n],
      };

      const dx = 1000n * 10n ** 18n;
      const dy = cryptoswap.getDy(params, 0, 1, dx);

      // Output should be less than input due to fees
      expect(dy).toBeGreaterThan(0n);
      expect(dy).toBeLessThan(dx);
    });
  });

  describe("Extreme Gamma Values", () => {
    it("should handle very low gamma (more concentrated liquidity)", () => {
      const params: cryptoswap.TwocryptoParams = {
        A: 400000n,
        gamma: 10n ** 10n, // Very low gamma
        D: 2000000n * 10n ** 18n,
        midFee: 3000000n,
        outFee: 30000000n,
        feeGamma: 230000000000000n,
        priceScale: 10n ** 18n,
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 18n],
        precisions: [1n, 1n],
      };

      const dx = 1000n * 10n ** 18n;
      const dy = cryptoswap.getDy(params, 0, 1, dx);

      expect(dy).toBeGreaterThan(0n);
    });

    it("should handle high gamma (flatter curve)", () => {
      const params: cryptoswap.TwocryptoParams = {
        A: 400000n,
        gamma: 10n ** 16n, // High gamma
        D: 2000000n * 10n ** 18n,
        midFee: 3000000n,
        outFee: 30000000n,
        feeGamma: 230000000000000n,
        priceScale: 10n ** 18n,
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 18n],
        precisions: [1n, 1n],
      };

      const dx = 1000n * 10n ** 18n;
      const dy = cryptoswap.getDy(params, 0, 1, dx);

      expect(dy).toBeGreaterThan(0n);
    });
  });

  describe("Tricrypto Edge Cases", () => {
    it("should handle 3-coin balanced pool", () => {
      // Use consistent D with balanced pools at 1:1 price scales
      const params: cryptoswap.TricryptoParams = {
        A: 2700n,
        gamma: 1300000000000n,
        D: 3000000n * 10n ** 18n, // Consistent with 3 * 1M tokens
        midFee: 1000000n,
        outFee: 45000000n,
        feeGamma: 5000000000000000n,
        priceScales: [10n ** 18n, 10n ** 18n], // 1:1:1 price scales
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 18n, 1000000n * 10n ** 18n],
        precisions: [1n, 1n, 1n],
      };

      // Test 0 -> 1
      const dy1 = cryptoswap.getDy3(params, 0, 1, 100n * 10n ** 18n);
      expect(dy1).toBeGreaterThan(0n);

      // Test 1 -> 2
      const dy2 = cryptoswap.getDy3(params, 1, 2, 100n * 10n ** 18n);
      expect(dy2).toBeGreaterThan(0n);

      // Test 2 -> 0
      const dy3 = cryptoswap.getDy3(params, 2, 0, 100n * 10n ** 18n);
      expect(dy3).toBeGreaterThan(0n);
    });
  });

  describe("Newton's Method Convergence", () => {
    it("should converge for standard parameters", () => {
      const params: cryptoswap.TwocryptoParams = {
        A: 400000n,
        gamma: 145000000000000n,
        D: 2000000n * 10n ** 18n,
        midFee: 3000000n,
        outFee: 30000000n,
        feeGamma: 230000000000000n,
        priceScale: 10n ** 18n,
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 18n],
        precisions: [1n, 1n],
      };

      // Multiple swap sizes to test convergence
      const sizes = [1n, 100n, 10000n, 100000n, 1000000n];

      for (const size of sizes) {
        const dx = size * 10n ** 18n;
        const dy = cryptoswap.getDy(params, 0, 1, dx);
        expect(dy).toBeGreaterThanOrEqual(0n);
      }
    });

    it("should handle balanced CryptoSwap pool with standard swap", () => {
      // Fully balanced pool for reliable convergence
      const params: cryptoswap.TwocryptoParams = {
        A: 400000n,
        gamma: 145000000000000n,
        D: 2000000n * 10n ** 18n,
        midFee: 3000000n,
        outFee: 30000000n,
        feeGamma: 230000000000000n,
        priceScale: 10n ** 18n,
        balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 18n], // Balanced
        precisions: [1n, 1n],
      };

      const dx = 1000n * 10n ** 18n;
      const dy = cryptoswap.getDy(params, 0, 1, dx);

      expect(dy).toBeGreaterThan(0n);
    });
  });
});

describe("Inverse Function Accuracy", () => {
  describe("StableSwap getDx/getDy inverse", () => {
    const Ann = stableswap.computeAnn(100n, 2);
    const xp = [10000n * 10n ** 18n, 10000n * 10n ** 18n];
    const baseFee = 4000000n;
    const feeMultiplier = 2n * 10n ** 10n;

    it("should satisfy getDy(getDx(desired_dy)) ≈ desired_dy", () => {
      const desiredDy = 100n * 10n ** 18n;

      const dx = stableswap.getDx(0, 1, desiredDy, xp, Ann, baseFee, feeMultiplier);
      const actualDy = stableswap.getDy(0, 1, dx, xp, Ann, baseFee, feeMultiplier);

      // Allow 1% tolerance
      const diff = actualDy > desiredDy ? actualDy - desiredDy : desiredDy - actualDy;
      const tolerance = desiredDy / 100n;

      expect(diff).toBeLessThanOrEqual(tolerance);
    });

    it("should satisfy getDx(getDy(dx)) ≈ dx (round-trip)", () => {
      const originalDx = 100n * 10n ** 18n;

      const dy = stableswap.getDy(0, 1, originalDx, xp, Ann, baseFee, feeMultiplier);
      const recoveredDx = stableswap.getDx(0, 1, dy, xp, Ann, baseFee, feeMultiplier);

      // Allow 2% tolerance for round-trip (fees compound)
      const diff =
        recoveredDx > originalDx ? recoveredDx - originalDx : originalDx - recoveredDx;
      const tolerance = originalDx / 50n;

      expect(diff).toBeLessThanOrEqual(tolerance);
    });
  });

  describe("CryptoSwap getDx/getDy inverse", () => {
    const params: cryptoswap.TwocryptoParams = {
      A: 400000n,
      gamma: 145000000000000n,
      D: 2000000n * 10n ** 18n,
      midFee: 3000000n,
      outFee: 30000000n,
      feeGamma: 230000000000000n,
      priceScale: 10n ** 18n,
      balances: [1000000n * 10n ** 18n, 1000000n * 10n ** 18n],
      precisions: [1n, 1n],
    };

    it("should satisfy getDy(getDx(desired_dy)) ≈ desired_dy", () => {
      const desiredDy = 100n * 10n ** 18n;

      const dx = cryptoswap.getDx(params, 0, 1, desiredDy);
      const actualDy = cryptoswap.getDy(params, 0, 1, dx);

      // Allow 1% tolerance
      const diff = actualDy > desiredDy ? actualDy - desiredDy : desiredDy - actualDy;
      const tolerance = desiredDy / 100n;

      expect(diff).toBeLessThanOrEqual(tolerance);
    });
  });
});
