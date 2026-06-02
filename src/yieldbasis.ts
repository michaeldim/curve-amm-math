/**
 * YieldBasis virtual pool math
 *
 * Off-chain implementation of YieldBasis VirtualPool.get_dy.
 * Virtual pools quote swaps between the stablecoin and the underlying asset
 * by routing through the YieldBasis leverage AMM and its backing Curve pool.
 *
 * References:
 * - YieldBasis VirtualPool.vy
 * - YieldBasis AMM.vy
 */

import { MAX_ITERATIONS, PRECISION } from "./constants";

export { PRECISION };

/** Small discount applied by YieldBasis VirtualPool for stablecoin input. */
export const ROUNDING_DISCOUNT = PRECISION / 100000000n;

/**
 * Current state returned by YieldBasis AMM.get_state().
 */
export interface YieldBasisAmmState {
  /** LP collateral held by the YieldBasis AMM */
  collateral: bigint;
  /** Current stablecoin debt, including accrued rate multiplier */
  debt: bigint;
  /** AMM x0 value computed from the oracle price and current state */
  x0: bigint;
}

/**
 * Parameters needed to quote a YieldBasis virtual pool.
 */
export interface YieldBasisVirtualPoolParams {
  /** YieldBasis AMM state */
  ammState: YieldBasisAmmState;
  /** Backing Curve pool balances: [stablecoin, asset] */
  poolBalances: [bigint, bigint];
  /** Backing Curve pool total LP token supply */
  poolTotalSupply: bigint;
  /** YieldBasis AMM fee, 1e18 precision */
  ammFee: bigint;
  /** Stablecoin-side rounding discount, defaults to ROUNDING_DISCOUNT */
  roundingDiscount?: bigint;
}

/**
 * Optional metadata returned by the RPC fetcher.
 */
export interface YieldBasisVirtualPoolRpcParams extends YieldBasisVirtualPoolParams {
  /** YieldBasis virtual pool address */
  virtualPoolAddress: string;
  /** YieldBasis AMM address used by the virtual pool */
  ammAddress: string;
  /** Backing Curve pool address */
  poolAddress: string;
}

/**
 * Result of the virtual pool calculation.
 */
export interface YieldBasisVirtualPoolCalculation {
  /** Output amount in the requested output coin's native decimals */
  outAmount: bigint;
  /** Stablecoin flash amount used by the virtual-pool route */
  flashAmount: bigint;
}

function assertUint(value: bigint, name: string): void {
  if (value < 0n) {
    throw new Error(`${name}: value cannot be negative`);
  }
}

function assertPositive(value: bigint, name: string): void {
  if (value <= 0n) {
    throw new Error(`${name}: value must be positive`);
  }
}

function ceilDiv(a: bigint, b: bigint): bigint {
  assertUint(a, "ceilDiv(a)");
  assertPositive(b, "ceilDiv(b)");
  return a === 0n ? 0n : (a - 1n) / b + 1n;
}

/**
 * Integer square root, matching Vyper isqrt floor rounding.
 */
export function isqrt(value: bigint): bigint {
  assertUint(value, "isqrt");
  if (value < 2n) return value;

  let x0 = value;
  let x1 = (value >> 1n) + 1n;

  while (x1 < x0) {
    x0 = x1;
    x1 = (x1 + value / x1) >> 1n;
  }

  return x0;
}

function validateVirtualPoolParams(params: YieldBasisVirtualPoolParams): void {
  assertUint(params.ammState.collateral, "ammState.collateral");
  assertUint(params.ammState.debt, "ammState.debt");
  assertUint(params.ammState.x0, "ammState.x0");
  assertUint(params.poolBalances[0], "poolBalances[0]");
  assertUint(params.poolBalances[1], "poolBalances[1]");
  assertUint(params.poolTotalSupply, "poolTotalSupply");
  assertUint(params.ammFee, "ammFee");
  if (params.ammFee > PRECISION) {
    throw new Error("ammFee: value cannot exceed 1e18");
  }
  if (params.roundingDiscount !== undefined) {
    assertUint(params.roundingDiscount, "roundingDiscount");
    if (params.roundingDiscount > PRECISION) {
      throw new Error("roundingDiscount: value cannot exceed 1e18");
    }
  }
}

/**
 * Quote the YieldBasis AMM directly for stablecoin <-> LP collateral swaps.
 *
 * This mirrors AMM.get_dy using AMM.get_state().x0 instead of recomputing x0.
 */
export function getAmmDy(
  state: YieldBasisAmmState,
  fee: bigint,
  i: number,
  j: number,
  inAmount: bigint
): bigint {
  if (i === j) return 0n;
  if (i < 0 || i > 1 || j < 0 || j > 1) return 0n;
  if (inAmount === 0n) return 0n;
  assertUint(inAmount, "inAmount");
  assertUint(fee, "fee");
  if (fee > PRECISION) {
    throw new Error("fee: value cannot exceed 1e18");
  }

  const { collateral, debt, x0 } = state;
  assertPositive(collateral, "ammState.collateral");
  if (x0 < debt) {
    throw new Error("ammState.x0 must be greater than or equal to ammState.debt");
  }

  const xInitial = x0 - debt;
  assertPositive(xInitial, "xInitial");

  if (i === 0) {
    if (inAmount > debt) {
      throw new Error("getAmmDy: stablecoin input exceeds AMM debt");
    }

    const x = xInitial + inAmount;
    const y = ceilDiv(xInitial * collateral, x);
    if (y >= collateral) return 0n;
    return ((collateral - y) * (PRECISION - fee)) / PRECISION;
  }

  const y = collateral + inAmount;
  const x = ceilDiv(xInitial * collateral, y);
  if (x >= xInitial) return 0n;
  return ((xInitial - x) * (PRECISION - fee)) / PRECISION;
}

/**
 * Run the internal YieldBasis virtual-pool calculation for one swap direction.
 *
 * Direction i=0 means stablecoin -> asset, i=1 means asset -> stablecoin.
 */
export function calculateVirtualPool(
  params: YieldBasisVirtualPoolParams,
  i: number,
  inAmount: bigint
): YieldBasisVirtualPoolCalculation {
  if (i < 0 || i > 1) {
    return { outAmount: 0n, flashAmount: 0n };
  }
  if (inAmount === 0n) {
    return { outAmount: 0n, flashAmount: 0n };
  }
  assertUint(inAmount, "inAmount");
  validateVirtualPoolParams(params);

  const [stablesInPool, cryptoInPool] = params.poolBalances;
  assertPositive(stablesInPool, "poolBalances[0]");
  assertPositive(cryptoInPool, "poolBalances[1]");

  if (i === 0) {
    assertPositive(params.poolTotalSupply, "poolTotalSupply");
    const r0fee =
      (stablesInPool * (PRECISION - params.ammFee)) / params.poolTotalSupply;
    const collateralFeeValue =
      (r0fee * params.ammState.collateral) / PRECISION;
    if (params.ammState.x0 < params.ammState.debt) {
      throw new Error("ammState.x0 must be greater than or equal to ammState.debt");
    }
    const xInitial = params.ammState.x0 - params.ammState.debt;
    const b = xInitial + inAmount - collateralFeeValue;

    if (b < 0n) {
      throw new Error("calculateVirtualPool: negative quadratic b value");
    }

    const d =
      b ** 2n +
      (((4n * params.ammState.collateral * r0fee) / PRECISION) * inAmount);
    const sqrtD = isqrt(d);
    if (sqrtD < b) {
      throw new Error("calculateVirtualPool: square root below b value");
    }

    const flashAmount = (sqrtD - b) / 2n;
    const outAmount = (flashAmount * cryptoInPool) / stablesInPool;
    return { outAmount, flashAmount };
  }

  const flashAmount = (inAmount * stablesInPool) / cryptoInPool;
  assertPositive(params.poolTotalSupply, "poolTotalSupply");
  const lpAmount = (params.poolTotalSupply * inAmount) / cryptoInPool;
  const ammOut = getAmmDy(params.ammState, params.ammFee, 1, 0, lpAmount);

  if (ammOut < flashAmount) {
    throw new Error("calculateVirtualPool: AMM output is below flash amount");
  }

  return { outAmount: ammOut - flashAmount, flashAmount };
}

/**
 * Off-chain implementation of YieldBasis VirtualPool.get_dy.
 *
 * Coin 0 is the stablecoin, coin 1 is the crypto asset in the backing Curve pool.
 */
export function getDy(
  params: YieldBasisVirtualPoolParams,
  i: number,
  j: number,
  inAmount: bigint
): bigint {
  if (i === j) return 0n;
  if (!((i === 0 && j === 1) || (i === 1 && j === 0))) return 0n;
  if (inAmount === 0n) return 0n;
  assertUint(inAmount, "inAmount");

  let adjustedInAmount = inAmount;
  if (i === 0) {
    const roundingDiscount = params.roundingDiscount ?? ROUNDING_DISCOUNT;
    assertUint(roundingDiscount, "roundingDiscount");
    if (roundingDiscount > PRECISION) {
      throw new Error("roundingDiscount: value cannot exceed 1e18");
    }
    adjustedInAmount =
      (inAmount * (PRECISION - roundingDiscount)) / PRECISION;
  }

  return calculateVirtualPool(params, i, adjustedInAmount).outAmount;
}

/**
 * Input amount needed for a desired virtual-pool output.
 *
 * Uses binary search because the virtual-pool contract exposes get_dy only.
 */
export function getDx(
  params: YieldBasisVirtualPoolParams,
  i: number,
  j: number,
  outAmount: bigint
): bigint {
  if (i === j) return 0n;
  if (!((i === 0 && j === 1) || (i === 1 && j === 0))) return 0n;
  if (outAmount === 0n) return 0n;
  assertUint(outAmount, "outAmount");

  const inputBalance = params.poolBalances[i];
  const outputBalance = params.poolBalances[j];
  let high =
    outputBalance > 0n
      ? (outAmount * inputBalance * 2n) / outputBalance + 1n
      : outAmount * 2n + 1n;

  if (high <= 0n) high = 1n;

  for (let k = 0; k < 64; k++) {
    if (getDy(params, i, j, high) >= outAmount) break;
    high *= 2n;
  }

  if (getDy(params, i, j, high) < outAmount) {
    return 0n;
  }

  let low = 0n;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const mid = (low + high) / 2n;
    if (mid === low) break;

    const quoted = getDy(params, i, j, mid);
    if (quoted >= outAmount) {
      high = mid;
    } else {
      low = mid;
    }

    if (high - low <= 1n) break;
  }

  return high;
}

/**
 * Effective output/input price in 1e18 precision for a virtual-pool swap.
 */
export function getEffectivePrice(
  params: YieldBasisVirtualPoolParams,
  i: number,
  j: number,
  inAmount: bigint
): bigint {
  if (inAmount === 0n) return 0n;
  const dy = getDy(params, i, j, inAmount);
  return (dy * PRECISION) / inAmount;
}
