/**
 * Convenience helpers for Curve 3pool / triCRV.
 *
 * triCRV is the LP token for the classic StableSwap 3pool
 * (DAI / USDC / USDT). It is not a Tricrypto-NG pool.
 */

import * as stableswapExact from "./stableswap-exact";

export const TRICRV_POOL_ADDRESS =
  "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7";

export const TRICRV_DECIMALS = [18, 6, 6] as const;
export const TRICRV_COINS = ["DAI", "USDC", "USDT"] as const;
export const TRICRV_RATES = stableswapExact.computeRates([...TRICRV_DECIMALS]);

export type TriCrvPoolParams = stableswapExact.ExactPoolParams;

/**
 * Create exact StableSwap params for classic 3pool / triCRV quotes.
 */
export function createTriCrvParams(
  balances: [bigint, bigint, bigint],
  A: bigint,
  fee: bigint,
  offpegFeeMultiplier: bigint = 0n
): TriCrvPoolParams {
  return {
    balances: [...balances],
    rates: [...TRICRV_RATES],
    A,
    fee,
    offpegFeeMultiplier,
  };
}

/**
 * Exact 3pool output quote using native token decimals.
 */
export function getDy(
  params: TriCrvPoolParams,
  i: number,
  j: number,
  dx: bigint
): bigint {
  return stableswapExact.getDyExact(i, j, dx, params);
}

/**
 * Exact 3pool input quote using native token decimals.
 */
export function getDx(
  params: TriCrvPoolParams,
  i: number,
  j: number,
  dy: bigint
): bigint {
  return stableswapExact.getDxExact(i, j, dy, params);
}
