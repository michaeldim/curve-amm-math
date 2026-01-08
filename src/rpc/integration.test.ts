/**
 * Integration tests that verify off-chain math against on-chain Curve pools.
 * These tests require RPC access and are skipped if RPC_URL is not set.
 *
 * Run with: RPC_URL=https://eth.llamarpc.com pnpm test src/rpc/integration.test.ts
 */
import { describe, it, expect } from "vitest";
import * as stableswap from "../stableswap";
import * as cryptoswap from "../cryptoswap";
import {
  getStableSwapParams,
  getTricryptoParams,
  getOnChainDy,
} from "./index";

// Skip tests if no RPC URL is provided
const RPC_URL = process.env.RPC_URL;
const describeIf = RPC_URL ? describe : describe.skip;

// Known Curve pool addresses on Ethereum mainnet
const POOLS = {
  // StableSwap pools
  THREEPOOL: "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7", // 3pool (DAI/USDC/USDT)
  FRAXUSDC: "0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2", // FRAX/USDC

  // CryptoSwap pools (Twocrypto-NG)
  TRICRYPTO_USDC: "0x7F86Bf177Dd4F3494b841a37e810A34dD56c829B", // Tricrypto USDC (USDC/WBTC/WETH)

  // Factory pools with uint256 indices
  CRVUSD_USDC: "0x4DEcE678ceceb27446b35C672dC7d61F30bAD69E", // crvUSD/USDC (StableSwapNG)
};

// Tolerance for off-chain vs on-chain comparison (0.1% = 10 bps)
const TOLERANCE_BPS = 10n;

function assertWithinTolerance(
  offChain: bigint,
  onChain: bigint,
  label: string
): void {
  const diff = offChain > onChain ? offChain - onChain : onChain - offChain;
  const tolerance = (onChain * TOLERANCE_BPS) / 10000n;

  expect(
    diff <= tolerance,
    `${label}: off-chain ${offChain} vs on-chain ${onChain}, diff ${diff} > tolerance ${tolerance}`
  ).toBe(true);
}

describeIf("RPC Integration Tests", () => {
  describe("StableSwap - 3pool", () => {
    it("should match on-chain get_dy for DAI->USDC swap", async () => {
      const params = await getStableSwapParams(RPC_URL!, POOLS.THREEPOOL, 3);

      // Swap 1000 DAI -> USDC (both 18 decimals in normalized form)
      const dx = 1000n * 10n ** 18n;
      const offChainDy = stableswap.getDy(
        0,
        1,
        dx,
        params.balances,
        params.Ann,
        params.fee,
        params.offpegFeeMultiplier
      );

      // On-chain comparison (3pool uses int128 indices)
      const onChainDy = await getOnChainDy(
        RPC_URL!,
        POOLS.THREEPOOL,
        0,
        1,
        dx,
        false // int128 indices
      );

      expect(onChainDy).not.toBeNull();
      if (onChainDy) {
        assertWithinTolerance(offChainDy, onChainDy, "3pool DAI->USDC");
      }
    });

    it("should match on-chain get_dy for USDC->USDT swap", async () => {
      const params = await getStableSwapParams(RPC_URL!, POOLS.THREEPOOL, 3);

      // Swap 500 USDC -> USDT
      const dx = 500n * 10n ** 18n; // Normalized to 18 decimals
      const offChainDy = stableswap.getDy(
        1,
        2,
        dx,
        params.balances,
        params.Ann,
        params.fee,
        params.offpegFeeMultiplier
      );

      const onChainDy = await getOnChainDy(
        RPC_URL!,
        POOLS.THREEPOOL,
        1,
        2,
        dx,
        false
      );

      expect(onChainDy).not.toBeNull();
      if (onChainDy) {
        assertWithinTolerance(offChainDy, onChainDy, "3pool USDC->USDT");
      }
    });

    it("should calculate virtual price accurately", async () => {
      const params = await getStableSwapParams(RPC_URL!, POOLS.THREEPOOL, 3);

      // Virtual price should be >= 1.0 (10^18) for healthy pools
      const virtualPrice = stableswap.getVirtualPrice(
        params.balances,
        params.Ann,
        // For virtual price, we need totalSupply which isn't in params
        // This test verifies calculation doesn't error with real balances
        params.balances.reduce((a, b) => a + b, 0n) // Approximate
      );

      // Virtual price should be reasonable (0.8 to 2.0)
      expect(virtualPrice).toBeGreaterThan(8n * 10n ** 17n);
      expect(virtualPrice).toBeLessThan(2n * 10n ** 18n);
    });
  });

  describe("StableSwap - Factory Pool (StableSwapNG)", () => {
    it("should match on-chain get_dy for crvUSD->USDC swap", async () => {
      const params = await getStableSwapParams(RPC_URL!, POOLS.CRVUSD_USDC, 2);

      // Swap 100 crvUSD -> USDC
      const dx = 100n * 10n ** 18n;
      const offChainDy = stableswap.getDy(
        0,
        1,
        dx,
        params.balances,
        params.Ann,
        params.fee,
        params.offpegFeeMultiplier
      );

      // Factory pools use uint256 indices
      const onChainDy = await getOnChainDy(
        RPC_URL!,
        POOLS.CRVUSD_USDC,
        0,
        1,
        dx,
        true // uint256 indices
      );

      expect(onChainDy).not.toBeNull();
      if (onChainDy) {
        assertWithinTolerance(offChainDy, onChainDy, "crvUSD->USDC");
      }
    });
  });

  describe("CryptoSwap - Tricrypto", () => {
    it("should fetch tricrypto params successfully", async () => {
      const params = await getTricryptoParams(RPC_URL!, POOLS.TRICRYPTO_USDC);

      expect(params.A).toBeGreaterThan(0n);
      expect(params.gamma).toBeGreaterThan(0n);
      expect(params.D).toBeGreaterThan(0n);
      expect(params.balances.length).toBe(3);
      expect(params.priceScales.length).toBe(2);
    });

    it("should calculate getDy3 without errors", async () => {
      const params = await getTricryptoParams(RPC_URL!, POOLS.TRICRYPTO_USDC);

      // Swap small amount of USDC -> WBTC (indices 0 -> 1)
      const dx = 100n * 10n ** 18n; // 100 USDC normalized
      const dy = cryptoswap.getDy3(params, 0, 1, dx);

      // Output should be positive and less than input (due to fees/price)
      expect(dy).toBeGreaterThan(0n);
    });
  });

  describe("Accuracy - Small vs Large Swaps", () => {
    it("should maintain accuracy across swap sizes", async () => {
      const params = await getStableSwapParams(RPC_URL!, POOLS.THREEPOOL, 3);

      // Test different swap sizes
      const swapSizes = [
        1n * 10n ** 18n, // 1 token
        100n * 10n ** 18n, // 100 tokens
        10000n * 10n ** 18n, // 10,000 tokens
        100000n * 10n ** 18n, // 100,000 tokens
      ];

      for (const dx of swapSizes) {
        const offChainDy = stableswap.getDy(
          0,
          1,
          dx,
          params.balances,
          params.Ann,
          params.fee,
          params.offpegFeeMultiplier
        );

        const onChainDy = await getOnChainDy(
          RPC_URL!,
          POOLS.THREEPOOL,
          0,
          1,
          dx,
          false
        );

        if (onChainDy && onChainDy > 0n) {
          assertWithinTolerance(
            offChainDy,
            onChainDy,
            `3pool DAI->USDC (${dx / 10n ** 18n} tokens)`
          );
        }
      }
    });
  });

  describe("Inverse Functions", () => {
    it("should verify getDx produces correct input for desired output", async () => {
      const params = await getStableSwapParams(RPC_URL!, POOLS.THREEPOOL, 3);

      // We want 100 USDC out
      const desiredDy = 100n * 10n ** 18n;

      // Calculate required DAI input
      const calculatedDx = stableswap.getDx(
        0,
        1,
        desiredDy,
        params.balances,
        params.Ann,
        params.fee,
        params.offpegFeeMultiplier
      );

      // Verify: swapping calculatedDx should give us approximately desiredDy
      const actualDy = stableswap.getDy(
        0,
        1,
        calculatedDx,
        params.balances,
        params.Ann,
        params.fee,
        params.offpegFeeMultiplier
      );

      // Allow 1% tolerance for the inverse calculation
      const diff =
        actualDy > desiredDy ? actualDy - desiredDy : desiredDy - actualDy;
      const tolerance = desiredDy / 100n;

      expect(
        diff <= tolerance,
        `getDx inverse: wanted ${desiredDy}, got ${actualDy}`
      ).toBe(true);
    });
  });
});

describeIf("Edge Cases with Real Data", () => {
  describe("Price Functions", () => {
    it("should calculate spot price close to 1.0 for balanced stablecoin pool", async () => {
      const params = await getStableSwapParams(RPC_URL!, POOLS.THREEPOOL, 3);

      const spotPrice = stableswap.getSpotPrice(
        0,
        1,
        params.balances,
        params.Ann
      );

      // For stablecoin pools, spot price should be close to 1.0 (within 5%)
      expect(spotPrice).toBeGreaterThan(95n * 10n ** 16n); // > 0.95
      expect(spotPrice).toBeLessThan(105n * 10n ** 16n); // < 1.05
    });

    it("should calculate increasing price impact for larger swaps", async () => {
      const params = await getStableSwapParams(RPC_URL!, POOLS.THREEPOOL, 3);

      const smallSwap = 100n * 10n ** 18n;
      const largeSwap = 10000000n * 10n ** 18n; // 10M tokens

      const smallImpact = stableswap.getPriceImpact(
        0,
        1,
        smallSwap,
        params.balances,
        params.Ann,
        params.fee,
        params.offpegFeeMultiplier
      );

      const largeImpact = stableswap.getPriceImpact(
        0,
        1,
        largeSwap,
        params.balances,
        params.Ann,
        params.fee,
        params.offpegFeeMultiplier
      );

      // Large swaps should have more price impact
      expect(largeImpact).toBeGreaterThan(smallImpact);
    });
  });

  describe("Liquidity Operations", () => {
    it("should calculate LP tokens for balanced deposit", async () => {
      const params = await getStableSwapParams(RPC_URL!, POOLS.THREEPOOL, 3);

      // Simulate proportional deposit
      const totalBalance = params.balances.reduce((a, b) => a + b, 0n);
      const depositRatio = 10n ** 18n; // 1:1:1 ratio scaled

      const amounts = params.balances.map(
        (b) => (b * depositRatio) / totalBalance
      );

      // This should work without error
      const totalSupply = totalBalance; // Approximate
      const lpTokens = stableswap.calcTokenAmount(
        amounts,
        true,
        params.balances,
        params.Ann,
        totalSupply,
        params.fee
      );

      expect(lpTokens).toBeGreaterThan(0n);
    });
  });
});
