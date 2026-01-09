/**
 * Curve StableSwap Math - EXACT PRECISION
 *
 * This module provides exact precision matching with on-chain Curve contracts
 * by replicating the exact order of operations from Vyper.
 *
 * Supports all StableSwap pool types:
 * - Classic StableSwap (3pool, etc.)
 * - StableSwapNG factory pools
 * - Pools with oracle tokens (wstETH, cbETH, etc.)
 * - Pools with ERC4626 tokens (sDAI, etc.)
 * - Metapools
 */

import {
  A_PRECISION,
  FEE_DENOMINATOR,
  MAX_ITERATIONS,
  PRECISION,
} from "./constants";

// Re-export for convenience
export { A_PRECISION, FEE_DENOMINATOR, MAX_ITERATIONS, PRECISION };

/**
 * Asset types for StableSwapNG pools
 */
export enum AssetType {
  /** Standard ERC20 token */
  STANDARD = 0,
  /** Token with rate oracle (wstETH, cbETH, etc.) */
  ORACLE = 1,
  /** Rebasing token (stETH) - balances change, rate static */
  REBASING = 2,
  /** ERC4626 vault token (sDAI, etc.) */
  ERC4626 = 3,
}

/**
 * Pool parameters for exact precision calculations
 */
export interface ExactPoolParams {
  /** Raw balances in native token decimals */
  balances: bigint[];
  /** Rate multipliers (call stored_rates() or compute from decimals) */
  rates: bigint[];
  /** Amplification parameter (raw A from contract, NOT multiplied by A_PRECISION) */
  A: bigint;
  /** Base fee (1e10 precision) */
  fee: bigint;
  /** Off-peg fee multiplier (1e10 precision), 0 if not supported */
  offpegFeeMultiplier: bigint;
}

/**
 * Convert balances to xp (normalized to 18 decimals)
 * Matches Vyper: xp[i] = rates[i] * balances[i] / PRECISION
 * @throws Error if balances and rates have different lengths
 */
export function getXp(balances: bigint[], rates: bigint[]): bigint[] {
  if (balances.length !== rates.length) {
    throw new Error(
      `getXp: balances length (${balances.length}) must match rates length (${rates.length})`
    );
  }
  return balances.map((bal, i) => (rates[i] * bal) / PRECISION);
}

/**
 * Calculate D (StableSwap invariant) - EXACT Vyper match
 *
 * @param xp - Normalized pool balances (from getXp)
 * @param amp - A * A_PRECISION
 * @param nCoins - Number of coins
 * @throws Error if any balance is zero or convergence fails
 */
export function getD(xp: bigint[], amp: bigint, nCoins: number): bigint {
  // Validate nCoins
  if (nCoins < 2) {
    throw new Error(`getD: pool must have at least 2 coins (got ${nCoins})`);
  }
  if (xp.length !== nCoins) {
    throw new Error(`getD: xp.length (${xp.length}) must match nCoins (${nCoins})`);
  }

  const N = BigInt(nCoins);

  // Guard against amp = 0 (invalid pool parameter)
  if (amp === 0n) {
    throw new Error("getD: amp (A parameter) cannot be zero");
  }

  let S = 0n;
  for (const x of xp) {
    S += x;
  }
  if (S === 0n) return 0n;

  // Check for zero balances (would cause division by zero)
  for (const x of xp) {
    if (x === 0n) {
      throw new Error("getD: zero balance would cause division by zero");
    }
  }

  let Dprev = 0n;
  let D = S;
  const Ann = amp * N;

  for (let i = 0; i < 255; i++) {
    let D_P = D;
    for (const x of xp) {
      D_P = (D_P * D) / x;
    }
    // Vyper: D_P /= pow_mod256(N_COINS, N_COINS)
    D_P = D_P / (N ** N);

    Dprev = D;
    // Vyper exact formula:
    // D = ((Ann * S / A_PRECISION + D_P * N_COINS) * D) /
    //     (((Ann - A_PRECISION) * D) / A_PRECISION + (N_COINS + 1) * D_P)
    D =
      (((Ann * S) / A_PRECISION + D_P * N) * D) /
      (((Ann - A_PRECISION) * D) / A_PRECISION + (N + 1n) * D_P);

    // Convergence check: |D - Dprev| <= 1
    if (D > Dprev) {
      if (D - Dprev <= 1n) return D;
    } else {
      if (Dprev - D <= 1n) return D;
    }
  }

  throw new Error("get_D did not converge");
}

/**
 * Calculate y given x values and D - EXACT Vyper match
 *
 * @param i - Input token index
 * @param j - Output token index
 * @param x - New value of xp[i] after input
 * @param xp - Current normalized balances
 * @param amp - A * A_PRECISION
 * @param D - Invariant from getD
 * @param nCoins - Number of coins
 * @throws Error if i === j, indices out of bounds, or zero balance
 */
export function getY(
  i: number,
  j: number,
  x: bigint,
  xp: bigint[],
  amp: bigint,
  D: bigint,
  nCoins: number
): bigint {
  // Input validation
  if (nCoins < 2) {
    throw new Error(`getY: pool must have at least 2 coins (got ${nCoins})`);
  }
  if (xp.length !== nCoins) {
    throw new Error(`getY: xp.length (${xp.length}) must match nCoins (${nCoins})`);
  }
  if (i === j) {
    throw new Error("getY: i and j must be different");
  }
  if (i < 0 || i >= nCoins || j < 0 || j >= nCoins) {
    throw new Error(`getY: index out of bounds (i=${i}, j=${j}, nCoins=${nCoins})`);
  }
  // Guard against amp = 0 (would cause division by zero)
  if (amp === 0n) {
    throw new Error("getY: amp (A parameter) cannot be zero");
  }

  const N = BigInt(nCoins);
  const Ann = amp * N;

  let c = D;
  let S_ = 0n;

  for (let k = 0; k < nCoins; k++) {
    let _x: bigint;
    if (k === i) {
      _x = x;
    } else if (k !== j) {
      _x = xp[k];
    } else {
      continue;
    }
    // Zero balance protection
    if (_x === 0n) {
      throw new Error(`getY: zero balance at index ${k} would cause division by zero`);
    }
    S_ += _x;
    c = (c * D) / (_x * N);
  }

  c = (c * D * A_PRECISION) / (Ann * N);
  const b = S_ + (D * A_PRECISION) / Ann;

  let y = D;
  for (let iter = 0; iter < 255; iter++) {
    const y_prev = y;
    const denom = 2n * y + b - D;
    // Guard against zero or negative denominator
    if (denom <= 0n) {
      throw new Error("getY: denominator (2y + b - D) is non-positive");
    }
    y = (y * y + c) / denom;

    if (y > y_prev) {
      if (y - y_prev <= 1n) return y;
    } else {
      if (y_prev - y <= 1n) return y;
    }
  }

  throw new Error("get_y did not converge");
}

/**
 * Calculate y given D (for liquidity operations) - EXACT Vyper match
 *
 * @param amp - A * A_PRECISION
 * @param i - Token index to solve for
 * @param xp - Current normalized balances
 * @param D - Target D invariant
 * @param nCoins - Number of coins
 * @throws Error if index out of bounds or zero balance
 */
export function getYD(
  amp: bigint,
  i: number,
  xp: bigint[],
  D: bigint,
  nCoins: number
): bigint {
  // Input validation
  if (nCoins < 2) {
    throw new Error(`getYD: pool must have at least 2 coins (got ${nCoins})`);
  }
  if (xp.length !== nCoins) {
    throw new Error(`getYD: xp.length (${xp.length}) must match nCoins (${nCoins})`);
  }
  if (i < 0 || i >= nCoins) {
    throw new Error(`getYD: index out of bounds (i=${i}, nCoins=${nCoins})`);
  }
  // Guard against amp = 0 (would cause division by zero)
  if (amp === 0n) {
    throw new Error("getYD: amp (A parameter) cannot be zero");
  }

  const N = BigInt(nCoins);
  const Ann = amp * N;

  let c = D;
  let S_ = 0n;

  for (let k = 0; k < nCoins; k++) {
    if (k !== i) {
      // Zero balance protection
      if (xp[k] === 0n) {
        throw new Error(`getYD: zero balance at index ${k} would cause division by zero`);
      }
      S_ += xp[k];
      c = (c * D) / (xp[k] * N);
    }
  }

  c = (c * D * A_PRECISION) / (Ann * N);
  const b = S_ + (D * A_PRECISION) / Ann;

  let y = D;
  for (let iter = 0; iter < 255; iter++) {
    const y_prev = y;
    const denom = 2n * y + b - D;
    // Guard against zero or negative denominator
    if (denom <= 0n) {
      throw new Error("getYD: denominator (2y + b - D) is non-positive");
    }
    y = (y * y + c) / denom;

    if (y > y_prev) {
      if (y - y_prev <= 1n) return y;
    } else {
      if (y_prev - y <= 1n) return y;
    }
  }

  throw new Error("get_y_D did not converge");
}

/**
 * Calculate dynamic fee - EXACT Vyper match
 */
export function dynamicFee(
  xpi: bigint,
  xpj: bigint,
  fee: bigint,
  feeMultiplier: bigint
): bigint {
  if (feeMultiplier <= FEE_DENOMINATOR) {
    return fee;
  }

  const xps2 = (xpi + xpj) ** 2n;
  // Guard against zero sum (would cause division by zero)
  if (xps2 === 0n) return fee;

  return (
    (feeMultiplier * fee) /
    (((feeMultiplier - FEE_DENOMINATOR) * 4n * xpi * xpj) / xps2 +
      FEE_DENOMINATOR)
  );
}

/**
 * Calculate get_dy - EXACT Vyper match
 *
 * This function replicates the exact operation order from CurveStableSwapNGViews.get_dy
 *
 * @param i - Input token index
 * @param j - Output token index
 * @param dx - Input amount in NATIVE decimals
 * @param params - Pool parameters
 * @returns Output amount in NATIVE decimals (0n for invalid inputs)
 */
export function getDyExact(
  i: number,
  j: number,
  dx: bigint,
  params: ExactPoolParams
): bigint {
  const { balances, rates, A, fee, offpegFeeMultiplier } = params;
  const nCoins = balances.length;

  // Input validation - return 0n for invalid swaps
  if (i === j) return 0n;
  if (i < 0 || i >= nCoins || j < 0 || j >= nCoins) return 0n;
  if (dx === 0n) return 0n;
  // Guard against zero rates (would cause division by zero)
  if (rates[i] === 0n || rates[j] === 0n) return 0n;

  // Step 1: Convert balances to xp (18 decimals)
  // Vyper: xp[k] = rates[k] * balances[k] / PRECISION
  const xp = getXp(balances, rates);

  // Step 2: Calculate amp
  // Vyper: amp = A() * A_PRECISION
  const amp = A * A_PRECISION;

  // Step 3: Calculate D
  const D = getD(xp, amp, nCoins);

  // Step 4: Calculate new x after input
  // Vyper: x = xp[i] + (dx * rates[i] / PRECISION)
  const x = xp[i] + (dx * rates[i]) / PRECISION;

  // Step 5: Calculate y
  const y = getY(i, j, x, xp, amp, D, nCoins);

  // Step 6: Calculate dy (in xp terms, 18 decimals)
  // Vyper: dy = xp[j] - y - 1
  const dy = xp[j] - y - 1n;

  // Clamp negative outputs to 0
  if (dy <= 0n) return 0n;

  // Step 7: Calculate dynamic fee
  // Vyper: fee = _dynamic_fee((xp[i] + x) / 2, (xp[j] + y) / 2, base_fee, fee_multiplier) * dy / FEE_DENOMINATOR
  const dynFee = dynamicFee(
    (xp[i] + x) / 2n,
    (xp[j] + y) / 2n,
    fee,
    offpegFeeMultiplier
  );
  const feeAmount = (dynFee * dy) / FEE_DENOMINATOR;

  // Step 8: Convert back to native decimals
  // Vyper: return (dy - fee) * PRECISION / rates[j]
  const result = ((dy - feeAmount) * PRECISION) / rates[j];
  return result > 0n ? result : 0n;
}

/**
 * Calculate get_dx using binary search for accuracy with dynamic fees
 *
 * This uses binary search to find the exact input amount that produces
 * the desired output, properly accounting for dynamic fees calculated
 * on average balances.
 *
 * @param i - Input token index
 * @param j - Output token index
 * @param dy - Desired output amount in NATIVE decimals
 * @param params - Pool parameters
 * @returns Required input amount in NATIVE decimals (0n for invalid inputs)
 */
export function getDxExact(
  i: number,
  j: number,
  dy: bigint,
  params: ExactPoolParams
): bigint {
  const { balances, rates } = params;
  const nCoins = balances.length;

  // Input validation - return 0n for invalid swaps
  if (i === j) return 0n;
  if (i < 0 || i >= nCoins || j < 0 || j >= nCoins) return 0n;
  if (dy === 0n) return 0n;
  // Guard against zero rates (would cause division by zero)
  if (rates[i] === 0n || rates[j] === 0n) return 0n;

  // Use binary search to find dx that produces dy
  // Initial estimate: assume 1:1 swap with some buffer for fees
  const maxBalance = balances.reduce((a, b) => (a > b ? a : b), 0n);
  let low = 0n;
  let high = maxBalance * 10n;

  // Expand upper bound if needed
  for (let k = 0; k < 10; k++) {
    const dyAtHigh = getDyExact(i, j, high, params);
    if (dyAtHigh >= dy) break;
    high = high * 2n;
  }

  // Final check: if dy is not achievable even with high input, return 0n
  const dyAtFinalHigh = getDyExact(i, j, high, params);
  if (dyAtFinalHigh < dy) return 0n;

  // Binary search for the correct dx
  for (let k = 0; k < 256; k++) {
    const mid = (low + high) / 2n;
    if (mid === low) {
      // Converged - return high to ensure we get at least dy
      return high;
    }

    const dyMid = getDyExact(i, j, mid, params);
    if (dyMid < dy) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return high;
}

// ============================================================================
// Rate Computation Helpers
// ============================================================================

/**
 * Compute static rate multipliers from decimals (for standard ERC20 tokens)
 *
 * This is what classic pools use: rate_multiplier[i] = 10^(36 - decimals[i])
 *
 * For StableSwapNG pools, you should fetch stored_rates() from the contract
 * instead, as rates may be dynamic for oracle/ERC4626 tokens.
 * @throws Error if any decimal is < 0 or > 36 (would cause invalid exponent)
 */
export function computeRates(decimals: number[]): bigint[] {
  return decimals.map((d, i) => {
    if (d < 0) {
      throw new Error(
        `computeRates: decimals[${i}] = ${d} cannot be negative`
      );
    }
    if (d > 36) {
      throw new Error(
        `computeRates: decimals[${i}] = ${d} exceeds maximum of 36`
      );
    }
    return 10n ** BigInt(36 - d);
  });
}

/**
 * Compute precision multipliers (for normalizing to 18 decimals)
 * precision[i] = 10^(18 - decimals[i])
 *
 * Note: This is different from rates! Rates are 10^(36-d), precisions are 10^(18-d)
 * @throws Error if any decimal is > 18 (would require negative exponent)
 */
export function computePrecisions(decimals: number[]): bigint[] {
  return decimals.map((d, i) => {
    if (d > 18) {
      throw new Error(
        `computePrecisions: decimals[${i}] = ${d} exceeds maximum of 18`
      );
    }
    if (d < 0) {
      throw new Error(
        `computePrecisions: decimals[${i}] = ${d} cannot be negative`
      );
    }
    return 10n ** BigInt(18 - d);
  });
}

/**
 * Helper to create ExactPoolParams from common inputs
 *
 * @param balances - Raw balances in native token decimals
 * @param decimals - Token decimals array
 * @param A - Raw A parameter from contract (NOT multiplied by A_PRECISION)
 * @param fee - Fee in 1e10 precision
 * @param offpegFeeMultiplier - Off-peg fee multiplier (0 if not supported)
 */
export function createExactParams(
  balances: bigint[],
  decimals: number[],
  A: bigint,
  fee: bigint,
  offpegFeeMultiplier: bigint = 0n
): ExactPoolParams {
  if (balances.length !== decimals.length) {
    throw new Error(
      `createExactParams: balances.length (${balances.length}) must match decimals.length (${decimals.length})`
    );
  }
  if (balances.length < 2) {
    throw new Error(`createExactParams: pool must have at least 2 coins (got ${balances.length})`);
  }
  return {
    balances,
    rates: computeRates(decimals),
    A,
    fee,
    offpegFeeMultiplier,
  };
}

/**
 * Create ExactPoolParams with custom rates (for oracle/ERC4626 tokens)
 *
 * Use this when the pool has non-standard asset types. Fetch rates from
 * the pool's stored_rates() function.
 */
export function createExactParamsWithRates(
  balances: bigint[],
  rates: bigint[],
  A: bigint,
  fee: bigint,
  offpegFeeMultiplier: bigint = 0n
): ExactPoolParams {
  if (balances.length !== rates.length) {
    throw new Error(
      `createExactParamsWithRates: balances.length (${balances.length}) must match rates.length (${rates.length})`
    );
  }
  if (balances.length < 2) {
    throw new Error(`createExactParamsWithRates: pool must have at least 2 coins (got ${balances.length})`);
  }
  // Validate rates are non-zero
  for (let i = 0; i < rates.length; i++) {
    if (rates[i] === 0n) {
      throw new Error(`createExactParamsWithRates: rate at index ${i} cannot be zero`);
    }
  }
  return {
    balances,
    rates,
    A,
    fee,
    offpegFeeMultiplier,
  };
}

// ============================================================================
// Pool Type Reference
// ============================================================================

/**
 * Pool types and their rate handling:
 *
 * | Pool Type             | Rate Source              | Notes                           |
 * |-----------------------|--------------------------|---------------------------------|
 * | Classic (3pool)       | 10^(36 - decimals)       | Static, use computeRates()     |
 * | StableSwapNG          | stored_rates()           | May include oracle rates        |
 * | Oracle tokens         | rate_multiplier * oracle | wstETH, cbETH, etc.            |
 * | ERC4626 tokens        | convertToAssets()        | sDAI, etc.                     |
 * | Rebasing tokens       | Static rate              | Balances change instead        |
 * | Metapools             | [rate, virtualPrice]     | LP token uses base pool vPrice |
 *
 * For maximum accuracy, always fetch stored_rates() from StableSwapNG pools
 * rather than computing from decimals.
 */
