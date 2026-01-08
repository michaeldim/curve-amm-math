/**
 * Curve StableSwap Math
 *
 * Off-chain implementation of Curve StableSwap formulas for gas-free calculations.
 * Supports 2-8 coins (the range supported by StableSwapNG pools).
 *
 * Based on the StableSwap invariant: A*n^n*sum(x) + D = A*D*n^n + D^(n+1)/(n^n*prod(x))
 *
 * References:
 * - StableSwap whitepaper: https://curve.fi/files/stableswap-paper.pdf
 * - Algorithm explanation: https://www.rareskills.io/post/curve-get-d-get-y
 */

// Re-export constants from shared module for backward compatibility
export {
  A_PRECISION,
  FEE_DENOMINATOR,
  MAX_ITERATIONS,
  PRECISION,
  BPS_DENOMINATOR,
  DEFAULT_SLIPPAGE_BPS,
  MIN_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
} from "./constants";

// Import only what's actually used in this file
import {
  A_PRECISION,
  FEE_DENOMINATOR,
  MAX_ITERATIONS,
  DEFAULT_SLIPPAGE_BPS,
  MIN_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
} from "./constants";

/**
 * Calculate D (StableSwap invariant) using Newton's method
 * D satisfies: A*n^n*sum(x) + D = A*D*n^n + D^(n+1)/(n^n*prod(x))
 *
 * @param xp - Normalized pool balances (same decimals, in wei)
 * @param Ann - A * A_PRECISION * N_COINS (pre-computed)
 * @returns D invariant value
 */
export function getD(xp: bigint[], Ann: bigint): bigint {
  const N = BigInt(xp.length);
  const N_COINS_POW = N ** N; // n^n

  // Sum of balances
  let S = 0n;
  for (const x of xp) {
    S += x;
  }
  if (S === 0n) return 0n;

  let D = S;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // D_P = D^(n+1) / (n^n * prod(x))
    // Computed incrementally: D_P = D; for x in xp: D_P = D_P * D / x; D_P /= n^n
    let D_P = D;
    for (const x of xp) {
      D_P = (D_P * D) / x;
    }
    D_P = D_P / N_COINS_POW;

    const Dprev = D;

    // Newton iteration:
    // numerator = (Ann * S / A_PRECISION + D_P * N) * D
    // denominator = (Ann - A_PRECISION) * D / A_PRECISION + (N + 1) * D_P
    const numerator = ((Ann * S) / A_PRECISION + D_P * N) * D;
    const denominator = ((Ann - A_PRECISION) * D) / A_PRECISION + (N + 1n) * D_P;
    D = numerator / denominator;

    // Convergence check
    if (D > Dprev ? D - Dprev <= 1n : Dprev - D <= 1n) {
      break;
    }
  }

  return D;
}

/**
 * Calculate y given x values and D using Newton's method
 * Solves for y[j] given all other x values and the invariant D
 *
 * @param i - Input token index
 * @param j - Output token index
 * @param x - New value of x[i] after input
 * @param xp - Current pool balances
 * @param Ann - A * A_PRECISION * N_COINS
 * @param D - Invariant (from getD)
 * @returns New value of y[j]
 */
export function getY(
  i: number,
  j: number,
  x: bigint,
  xp: bigint[],
  Ann: bigint,
  D: bigint
): bigint {
  const N = BigInt(xp.length);

  // c = D^(n+1) / (n^n * prod(x_k for k != j) * Ann * n)
  // b = S' + D / (Ann * n) where S' = sum(x_k for k != j)
  let c = D;
  let S = 0n;

  for (let k = 0; k < xp.length; k++) {
    let _x: bigint;
    if (k === i) {
      _x = x;
    } else if (k !== j) {
      _x = xp[k];
    } else {
      continue;
    }
    S += _x;
    c = (c * D) / (_x * N);
  }

  c = (c * D * A_PRECISION) / (Ann * N);
  const b = S + (D * A_PRECISION) / Ann;

  // Newton iteration for y
  let y = D;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const prevY = y;
    // y = (y^2 + c) / (2y + b - D)
    y = (y * y + c) / (2n * y + b - D);

    if (y > prevY ? y - prevY <= 1n : prevY - y <= 1n) {
      break;
    }
  }

  return y;
}

/**
 * Calculate dynamic fee based on pool balance
 * Fee increases when pool is imbalanced (far from equal weights)
 *
 * @param xpi - Balance of input token (normalized)
 * @param xpj - Balance of output token (normalized)
 * @param baseFee - Base fee from pool
 * @param feeMultiplier - Off-peg fee multiplier
 * @returns Dynamic fee to apply
 */
export function dynamicFee(
  xpi: bigint,
  xpj: bigint,
  baseFee: bigint,
  feeMultiplier: bigint
): bigint {
  if (feeMultiplier <= FEE_DENOMINATOR) return baseFee;

  const xps2 = (xpi + xpj) ** 2n;
  return (
    (feeMultiplier * baseFee) /
    (((feeMultiplier - FEE_DENOMINATOR) * 4n * xpi * xpj) / xps2 + FEE_DENOMINATOR)
  );
}

/**
 * Calculate get_dy (output amount for input dx)
 * Exact match of CurveStableSwapNGViews.get_dy
 *
 * @param i - Input token index
 * @param j - Output token index
 * @param dx - Input amount (in token[i] decimals, normalized to 18)
 * @param xp - Pool balances (normalized to 18 decimals)
 * @param Ann - A * A_PRECISION * N_COINS
 * @param baseFee - Base fee from pool
 * @param feeMultiplier - Off-peg fee multiplier from pool
 * @returns Expected output amount after fees
 */
export function getDy(
  i: number,
  j: number,
  dx: bigint,
  xp: bigint[],
  Ann: bigint,
  baseFee: bigint,
  feeMultiplier: bigint
): bigint {
  // Calculate new x after input
  const newXp = [...xp];
  newXp[i] = xp[i] + dx;

  const D = getD(xp, Ann);
  const y = getY(i, j, newXp[i], xp, Ann, D);
  const dy = xp[j] - y - 1n; // -1 for rounding

  // Fee uses AVERAGE of pre and post xp values (matches Views contract)
  const fee = dynamicFee(
    (xp[i] + newXp[i]) / 2n,
    (xp[j] + y) / 2n,
    baseFee,
    feeMultiplier
  );
  const feeAmount = (dy * fee) / FEE_DENOMINATOR;

  return dy - feeAmount;
}

/**
 * Find the peg point using binary search on off-chain math
 * Returns max input amount where swap output >= input (rate >= 1:1)
 *
 * @param i - Input token index
 * @param j - Output token index
 * @param xp - Pool balances
 * @param Ann - A * A_PRECISION * N_COINS
 * @param fee - Base fee
 * @param feeMultiplier - Off-peg fee multiplier
 * @param precision - Search precision (default 10 tokens worth of wei)
 * @returns Maximum input amount that yields >= 1:1 output
 */
export function findPegPoint(
  i: number,
  j: number,
  xp: bigint[],
  Ann: bigint,
  fee: bigint,
  feeMultiplier: bigint,
  precision: bigint = 10n * 10n ** 18n
): bigint {
  // If input token balance >= output token balance, no swap gives bonus
  if (xp[i] >= xp[j]) {
    return 0n;
  }

  let low = 0n;
  let high = xp[j] - xp[i]; // imbalance as upper bound

  while (high - low > precision) {
    const mid = (low + high) / 2n;
    const dy = getDy(i, j, mid, xp, Ann, fee, feeMultiplier);
    if (dy >= mid) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

/**
 * Calculate min output with slippage tolerance
 * @param expectedOutput - Expected output from getDy
 * @param slippageBps - Slippage in basis points (100 = 1%)
 * @returns min_dy value accounting for slippage
 */
export function calculateMinDy(expectedOutput: bigint, slippageBps: number): string {
  const minDy = (expectedOutput * BigInt(10000 - slippageBps)) / BigInt(10000);
  return minDy.toString();
}

/**
 * Validate slippage parameter
 * @param slippage - Slippage in basis points as string (100 = 1%)
 * @returns Validated slippage in basis points as number
 * @throws Error if slippage is invalid or out of range
 */
export function validateSlippage(slippage: string | undefined): number {
  const bps = parseInt(slippage ?? String(DEFAULT_SLIPPAGE_BPS), 10);
  if (isNaN(bps) || bps < MIN_SLIPPAGE_BPS || bps > MAX_SLIPPAGE_BPS) {
    throw new Error(
      `Invalid slippage: ${slippage}. Must be ${MIN_SLIPPAGE_BPS}-${MAX_SLIPPAGE_BPS} bps (0.1%-50%)`
    );
  }
  return bps;
}

/**
 * Convert raw A value to Ann (A * A_PRECISION * N_COINS)
 * @param A - Amplification parameter
 * @param nCoins - Number of coins in pool
 * @param isAPrecise - Whether A is already multiplied by A_PRECISION
 */
export function computeAnn(A: bigint, nCoins: number, isAPrecise: boolean = false): bigint {
  const N = BigInt(nCoins);
  if (isAPrecise) {
    return A * N;
  }
  return A * A_PRECISION * N;
}

/**
 * Pool parameters needed for off-chain calculations
 */
export interface StableSwapPoolParams {
  balances: bigint[];
  A: bigint;
  Ann: bigint;
  fee: bigint;
  offpegFeeMultiplier: bigint;
  nCoins: number;
  /** Total LP token supply (needed for liquidity calculations) */
  totalSupply?: bigint;
}

/**
 * Calculate y given D using Newton's method
 * Used for liquidity calculations where D changes (add/remove liquidity)
 * Differs from getY which keeps D constant
 *
 * @param i - Index of token to solve for
 * @param xp - Pool balances (will use all except index i)
 * @param Ann - A * A_PRECISION * N_COINS
 * @param D - Target D invariant
 * @returns Value of y[i] that satisfies invariant with given D
 */
export function getYD(i: number, xp: bigint[], Ann: bigint, D: bigint): bigint {
  const N = BigInt(xp.length);

  // c = D^(n+1) / (n^n * prod(x_k for k != i) * Ann * n)
  // S = sum(x_k for k != i)
  let c = D;
  let S = 0n;

  for (let k = 0; k < xp.length; k++) {
    if (k !== i) {
      S += xp[k];
      c = (c * D) / (xp[k] * N);
    }
  }

  c = (c * D * A_PRECISION) / (Ann * N);
  const b = S + (D * A_PRECISION) / Ann;

  // Newton iteration for y
  let y = D;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const prevY = y;
    // y = (y^2 + c) / (2y + b - D)
    y = (y * y + c) / (2n * y + b - D);

    if (y > prevY ? y - prevY <= 1n : prevY - y <= 1n) {
      break;
    }
  }

  return y;
}

/**
 * Calculate get_dx (input amount needed for desired output dy)
 * Reverse of getDy - given how much you want out, calculate how much to put in
 *
 * @param i - Input token index
 * @param j - Output token index
 * @param dy - Desired output amount
 * @param xp - Pool balances (normalized to 18 decimals)
 * @param Ann - A * A_PRECISION * N_COINS
 * @param baseFee - Base fee from pool
 * @param feeMultiplier - Off-peg fee multiplier from pool
 * @returns Required input amount to receive dy output
 */
export function getDx(
  i: number,
  j: number,
  dy: bigint,
  xp: bigint[],
  Ann: bigint,
  baseFee: bigint,
  feeMultiplier: bigint
): bigint {
  if (dy === 0n) return 0n;
  if (dy >= xp[j]) return 0n; // Can't withdraw more than pool has

  const D = getD(xp, Ann);

  // Estimate fee to gross up dy
  // Use current balances for fee estimation (approximation)
  const fee = dynamicFee(xp[i], xp[j], baseFee, feeMultiplier);

  // Gross up dy to account for fee (dy_before_fee = dy * FEE_DENOM / (FEE_DENOM - fee))
  const dyWithFee = (dy * FEE_DENOMINATOR) / (FEE_DENOMINATOR - fee);

  // New y[j] after withdrawal
  const newY = xp[j] - dyWithFee;
  if (newY <= 0n) return 0n;

  // Use getY to find what x[i] needs to be for this y[j]
  // We pass newY as if it were x[i], and solve for the "other" token
  // But getY expects a different interface - we need to construct xp with newY at j
  const newXp = [...xp];
  newXp[j] = newY;

  // Now find x[i] using Newton's method
  // We need to solve for x[i] given newXp[j] and all other balances
  const x = getY(j, i, newY, xp, Ann, D);

  // dx is the difference
  const dx = x - xp[i] + 1n; // +1 for rounding up

  return dx > 0n ? dx : 0n;
}

/**
 * Calculate LP tokens received for depositing amounts
 * Matches calc_token_amount from Curve pools
 *
 * @param amounts - Amount of each token to deposit
 * @param isDeposit - true for deposit, false for withdrawal
 * @param xp - Current pool balances
 * @param Ann - A * A_PRECISION * N_COINS
 * @param totalSupply - Current LP token total supply
 * @param fee - Base fee
 * @returns LP tokens to mint (deposit) or burn (withdrawal)
 */
export function calcTokenAmount(
  amounts: bigint[],
  isDeposit: boolean,
  xp: bigint[],
  Ann: bigint,
  totalSupply: bigint,
  fee: bigint
): bigint {
  const N = BigInt(xp.length);
  const N_COINS = xp.length;

  const D0 = getD(xp, Ann);
  if (D0 === 0n && totalSupply === 0n) {
    // First deposit - LP tokens = D
    const newXp = amounts.map((a, idx) => xp[idx] + a);
    return getD(newXp, Ann);
  }

  // Calculate new balances
  const newXp = xp.map((bal, idx) =>
    isDeposit ? bal + amounts[idx] : bal - amounts[idx]
  );

  const D1 = getD(newXp, Ann);

  // Apply fee for imbalanced deposits/withdrawals
  // fee per token = fee * N_COINS / (4 * (N_COINS - 1))
  const tokenFee = (fee * N) / (4n * (N - 1n));

  // Calculate fee on difference from ideal balance change
  let D2 = D1;
  if (totalSupply > 0n) {
    const xpReduced: bigint[] = [];
    for (let i = 0; i < N_COINS; i++) {
      const idealBalance = (xp[i] * D1) / D0;
      const diff = newXp[i] > idealBalance
        ? newXp[i] - idealBalance
        : idealBalance - newXp[i];
      xpReduced.push(newXp[i] - (tokenFee * diff) / FEE_DENOMINATOR);
    }
    D2 = getD(xpReduced, Ann);
  }

  // LP tokens to mint/burn
  if (totalSupply === 0n) {
    return D1;
  }

  const diff = isDeposit ? D2 - D0 : D0 - D2;
  return (totalSupply * diff) / D0;
}

/**
 * Calculate tokens received for single-sided LP withdrawal
 * Matches calc_withdraw_one_coin from Curve pools
 *
 * @param tokenAmount - LP tokens to burn
 * @param i - Index of token to withdraw
 * @param xp - Current pool balances
 * @param Ann - A * A_PRECISION * N_COINS
 * @param totalSupply - Current LP token total supply
 * @param fee - Base fee
 * @returns [dy, fee_amount] - tokens received and fee charged
 */
export function calcWithdrawOneCoin(
  tokenAmount: bigint,
  i: number,
  xp: bigint[],
  Ann: bigint,
  totalSupply: bigint,
  fee: bigint
): [bigint, bigint] {
  const N = BigInt(xp.length);
  const N_COINS = xp.length;

  const D0 = getD(xp, Ann);

  // D1 = D0 - tokenAmount * D0 / totalSupply
  const D1 = D0 - (tokenAmount * D0) / totalSupply;

  // Calculate new y[i] for the reduced D
  const newY = getYD(i, xp, Ann, D1);

  // Fee per token = fee * N_COINS / (4 * (N_COINS - 1))
  const tokenFee = (fee * N) / (4n * (N - 1n));

  // Calculate reduced balances for fee calculation
  const xpReduced: bigint[] = [];
  for (let j = 0; j < N_COINS; j++) {
    let dxExpected: bigint;
    if (j === i) {
      dxExpected = (xp[j] * D1) / D0 - newY;
    } else {
      dxExpected = xp[j] - (xp[j] * D1) / D0;
    }
    xpReduced.push(xp[j] - (tokenFee * dxExpected) / FEE_DENOMINATOR);
  }

  // Final y after fee
  const finalY = getYD(i, xpReduced, Ann, D1);

  // dy = xpReduced[i] - finalY - 1 (for rounding)
  const dy = xpReduced[i] - finalY - 1n;
  const feeAmount = xp[i] - newY - dy;

  return [dy > 0n ? dy : 0n, feeAmount > 0n ? feeAmount : 0n];
}

// ============================================
// Additional Core Functions
// ============================================

/**
 * Calculate virtual price of LP token
 * Virtual price = D / totalSupply (normalized to 18 decimals)
 *
 * @param xp - Pool balances (normalized)
 * @param Ann - A * A_PRECISION * N_COINS
 * @param totalSupply - Total LP token supply
 * @returns Virtual price (18 decimals, 1e18 = 1.0)
 */
export function getVirtualPrice(
  xp: bigint[],
  Ann: bigint,
  totalSupply: bigint
): bigint {
  if (totalSupply === 0n) return 10n ** 18n;
  const D = getD(xp, Ann);
  return (D * 10n ** 18n) / totalSupply;
}

/**
 * Calculate balanced (proportional) removal of liquidity
 * Returns amounts of each token received for burning LP tokens
 *
 * @param tokenAmount - LP tokens to burn
 * @param xp - Current pool balances
 * @param totalSupply - Total LP token supply
 * @returns Array of token amounts to receive
 */
export function calcRemoveLiquidity(
  tokenAmount: bigint,
  xp: bigint[],
  totalSupply: bigint
): bigint[] {
  if (totalSupply === 0n) return xp.map(() => 0n);
  return xp.map((bal) => (bal * tokenAmount) / totalSupply);
}

/**
 * Calculate LP tokens needed for removing specific amounts (imbalanced)
 * Reverse of add_liquidity with specific amounts
 *
 * @param amounts - Desired amounts to withdraw
 * @param xp - Current pool balances
 * @param Ann - A * A_PRECISION * N_COINS
 * @param totalSupply - Total LP token supply
 * @param fee - Base fee
 * @returns LP tokens needed to burn
 */
export function calcRemoveLiquidityImbalance(
  amounts: bigint[],
  xp: bigint[],
  Ann: bigint,
  totalSupply: bigint,
  fee: bigint
): bigint {
  // This is essentially the inverse of calcTokenAmount for withdrawal
  // We calculate how many LP tokens need to be burned to get these amounts out
  const N = BigInt(xp.length);
  const N_COINS = xp.length;

  const D0 = getD(xp, Ann);
  const newXp = xp.map((bal, idx) => bal - amounts[idx]);
  const D1 = getD(newXp, Ann);

  // Fee calculation
  const tokenFee = (fee * N) / (4n * (N - 1n));
  const xpReduced: bigint[] = [];
  for (let i = 0; i < N_COINS; i++) {
    const idealBalance = (xp[i] * D1) / D0;
    const diff = newXp[i] > idealBalance
      ? newXp[i] - idealBalance
      : idealBalance - newXp[i];
    xpReduced.push(newXp[i] - (tokenFee * diff) / FEE_DENOMINATOR);
  }

  const D2 = getD(xpReduced, Ann);
  const lpTokens = ((D0 - D2) * totalSupply) / D0;

  return lpTokens + 1n; // Round up
}

// ============================================
// Price Functions
// ============================================

/**
 * Get spot price (exchange rate for infinitesimal swap)
 * This is the derivative of the swap function at current point
 *
 * @param i - Input token index
 * @param j - Output token index
 * @param xp - Pool balances
 * @param Ann - A * A_PRECISION * N_COINS
 * @returns Spot price (18 decimals): how many j tokens per 1 i token
 */
export function getSpotPrice(
  i: number,
  j: number,
  xp: bigint[],
  Ann: bigint
): bigint {
  // Use very small dx to approximate derivative
  const dx = 10n ** 12n; // 0.000001 tokens
  const D = getD(xp, Ann);
  const newXp = [...xp];
  newXp[i] = xp[i] + dx;
  const y = getY(i, j, newXp[i], xp, Ann, D);
  const dy = xp[j] - y;

  // Scale to 18 decimals
  return (dy * 10n ** 18n) / dx;
}

/**
 * Get effective price for a swap (actual dy/dx ratio)
 *
 * @param i - Input token index
 * @param j - Output token index
 * @param dx - Input amount
 * @param xp - Pool balances
 * @param Ann - A * A_PRECISION * N_COINS
 * @param baseFee - Base fee
 * @param feeMultiplier - Off-peg fee multiplier
 * @returns Effective price (18 decimals)
 */
export function getEffectivePrice(
  i: number,
  j: number,
  dx: bigint,
  xp: bigint[],
  Ann: bigint,
  baseFee: bigint,
  feeMultiplier: bigint
): bigint {
  if (dx === 0n) return getSpotPrice(i, j, xp, Ann);
  const dy = getDy(i, j, dx, xp, Ann, baseFee, feeMultiplier);
  return (dy * 10n ** 18n) / dx;
}

/**
 * Calculate price impact for a swap
 * Price impact = (spotPrice - effectivePrice) / spotPrice * 100
 *
 * @param i - Input token index
 * @param j - Output token index
 * @param dx - Input amount
 * @param xp - Pool balances
 * @param Ann - A * A_PRECISION * N_COINS
 * @param baseFee - Base fee
 * @param feeMultiplier - Off-peg fee multiplier
 * @returns Price impact in basis points (100 = 1%)
 */
export function getPriceImpact(
  i: number,
  j: number,
  dx: bigint,
  xp: bigint[],
  Ann: bigint,
  baseFee: bigint,
  feeMultiplier: bigint
): bigint {
  const spotPrice = getSpotPrice(i, j, xp, Ann);
  const effectivePrice = getEffectivePrice(i, j, dx, xp, Ann, baseFee, feeMultiplier);

  if (spotPrice === 0n) return 0n;

  // Calculate impact in basis points
  const impact = ((spotPrice - effectivePrice) * 10000n) / spotPrice;
  return impact > 0n ? impact : 0n;
}

// ============================================
// Fee Functions
// ============================================

/**
 * Calculate fee charged for add/remove liquidity operations
 * Fee is charged on the imbalance from ideal proportional deposit
 *
 * @param amounts - Amounts being deposited/withdrawn
 * @param xp - Current pool balances
 * @param Ann - A * A_PRECISION * N_COINS
 * @param fee - Base fee
 * @param isDeposit - true for deposit, false for withdrawal
 * @returns Total fee amount in D terms
 */
export function calcTokenFee(
  amounts: bigint[],
  xp: bigint[],
  Ann: bigint,
  fee: bigint,
  isDeposit: boolean
): bigint {
  const N = BigInt(xp.length);
  const N_COINS = xp.length;

  const D0 = getD(xp, Ann);
  if (D0 === 0n) return 0n;

  const newXp = xp.map((bal, idx) =>
    isDeposit ? bal + amounts[idx] : bal - amounts[idx]
  );

  const D1 = getD(newXp, Ann);
  const tokenFee = (fee * N) / (4n * (N - 1n));

  let totalFee = 0n;
  for (let i = 0; i < N_COINS; i++) {
    const idealBalance = (xp[i] * D1) / D0;
    const diff = newXp[i] > idealBalance
      ? newXp[i] - idealBalance
      : idealBalance - newXp[i];
    totalFee += (tokenFee * diff) / FEE_DENOMINATOR;
  }

  return totalFee;
}

/**
 * Calculate dynamic fee at hypothetical balances
 *
 * @param xpi - Hypothetical balance of token i
 * @param xpj - Hypothetical balance of token j
 * @param baseFee - Base fee
 * @param feeMultiplier - Off-peg fee multiplier
 * @returns Fee in FEE_DENOMINATOR units
 */
export function getFeeAtBalance(
  xpi: bigint,
  xpj: bigint,
  baseFee: bigint,
  feeMultiplier: bigint
): bigint {
  return dynamicFee(xpi, xpj, baseFee, feeMultiplier);
}

// ============================================
// Ramping Functions
// ============================================

/**
 * Calculate A parameter during ramping
 * A changes linearly from initial_A to future_A over the ramping period
 *
 * @param initialA - A at start of ramp
 * @param futureA - A at end of ramp
 * @param initialTime - Unix timestamp of ramp start
 * @param futureTime - Unix timestamp of ramp end
 * @param currentTime - Current unix timestamp
 * @returns Current A value
 */
export function getAAtTime(
  initialA: bigint,
  futureA: bigint,
  initialTime: bigint,
  futureTime: bigint,
  currentTime: bigint
): bigint {
  if (currentTime >= futureTime) {
    return futureA;
  }
  if (currentTime <= initialTime) {
    return initialA;
  }

  const elapsed = currentTime - initialTime;
  const duration = futureTime - initialTime;

  if (futureA > initialA) {
    return initialA + ((futureA - initialA) * elapsed) / duration;
  } else {
    return initialA - ((initialA - futureA) * elapsed) / duration;
  }
}

// ============================================
// Metapool Functions
// ============================================

/**
 * Parameters for metapool calculations
 */
export interface MetapoolParams {
  /** Metapool balances [meta_token, base_lp_token] */
  balances: [bigint, bigint];
  /** Metapool Ann */
  Ann: bigint;
  /** Metapool fee */
  fee: bigint;
  /** Metapool offpeg multiplier */
  feeMultiplier: bigint;
  /** Base pool balances */
  baseBalances: bigint[];
  /** Base pool Ann */
  baseAnn: bigint;
  /** Base pool fee */
  baseFee: bigint;
  /** Base pool offpeg multiplier */
  baseFeeMultiplier: bigint;
  /** Base pool virtual price */
  baseVirtualPrice: bigint;
}

/**
 * Calculate get_dy for metapool (swapping through underlying)
 * Supports swaps between meta token and base pool underlying tokens
 *
 * @param params - Metapool parameters
 * @param i - Input token index (0 = meta, 1+ = base underlying)
 * @param j - Output token index (0 = meta, 1+ = base underlying)
 * @param dx - Input amount
 * @returns Output amount
 */
export function getDyUnderlying(
  params: MetapoolParams,
  i: number,
  j: number,
  dx: bigint
): bigint {
  const {
    balances,
    Ann,
    fee,
    feeMultiplier,
    baseBalances,
    baseAnn,
    baseFee,
    baseFeeMultiplier,
    baseVirtualPrice,
  } = params;

  // Normalize metapool balances using base virtual price
  const xp: [bigint, bigint] = [
    balances[0],
    (balances[1] * baseVirtualPrice) / 10n ** 18n,
  ];

  if (i === 0 && j === 0) return 0n;

  // Meta -> Base underlying
  if (i === 0) {
    // First swap meta -> base LP in metapool
    const dyBaseLp = getDy(0, 1, dx, xp, Ann, fee, feeMultiplier);
    // Scale base LP to underlying amount
    const baseAmount = (dyBaseLp * baseVirtualPrice) / 10n ** 18n;
    // Then withdraw from base pool (single-sided)
    const baseIdx = j - 1;
    const [dyUnderlying] = calcWithdrawOneCoin(
      baseAmount,
      baseIdx,
      baseBalances,
      baseAnn,
      baseVirtualPrice, // Using virtual price as proxy for total supply
      baseFee
    );
    return dyUnderlying;
  }

  // Base underlying -> Meta
  if (j === 0) {
    // First deposit to base pool (single-sided)
    const baseIdx = i - 1;
    const amounts = baseBalances.map((_, idx) => (idx === baseIdx ? dx : 0n));
    const baseLpReceived = calcTokenAmount(
      amounts,
      true,
      baseBalances,
      baseAnn,
      baseVirtualPrice,
      baseFee
    );
    // Normalize LP to value terms
    const baseLpValue = (baseLpReceived * baseVirtualPrice) / 10n ** 18n;
    // Then swap base LP -> meta in metapool
    const xpAfter: [bigint, bigint] = [
      xp[0],
      xp[1] + baseLpValue,
    ];
    const D = getD(xp, Ann);
    const y = getY(1, 0, xpAfter[1], xp, Ann, D);
    let dy = xp[0] - y - 1n;
    const dynamicFeeAmt = dynamicFee(xpAfter[1], y, fee, feeMultiplier);
    dy = dy - (dy * dynamicFeeAmt) / FEE_DENOMINATOR;
    return dy;
  }

  // Base underlying -> Base underlying (through base pool directly)
  const baseIdxIn = i - 1;
  const baseIdxOut = j - 1;
  return getDy(
    baseIdxIn,
    baseIdxOut,
    dx,
    baseBalances,
    baseAnn,
    baseFee,
    baseFeeMultiplier
  );
}

/**
 * Calculate get_dx for metapool (input needed for desired underlying output)
 * Uses binary search
 *
 * @param params - Metapool parameters
 * @param i - Input token index
 * @param j - Output token index
 * @param dy - Desired output amount
 * @returns Required input amount
 */
export function getDxUnderlying(
  params: MetapoolParams,
  i: number,
  j: number,
  dy: bigint
): bigint {
  if (dy === 0n) return 0n;

  // Binary search for dx
  const maxBalance = i === 0 ? params.balances[0] : params.baseBalances[i - 1];
  let low = 0n;
  let high = maxBalance * 10n;
  const tolerance = dy / 10000n;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const mid = (low + high) / 2n;
    const dyCalc = getDyUnderlying(params, i, j, mid);

    if (dyCalc >= dy) {
      const diff = dyCalc - dy;
      if (diff <= tolerance) {
        high = mid;
        if (high - low <= 1n) return mid;
      } else {
        high = mid;
      }
    } else {
      low = mid;
    }

    if (high - low <= 1n) break;
  }

  return high;
}

// ============================================
// Utility Wrappers
// ============================================

/**
 * Full swap quote with all relevant information
 */
export interface SwapQuote {
  /** Output amount after fees */
  amountOut: bigint;
  /** Fee amount charged */
  fee: bigint;
  /** Price impact in basis points */
  priceImpact: bigint;
  /** Effective price (dy/dx in 18 decimals) */
  effectivePrice: bigint;
  /** Spot price before swap */
  spotPrice: bigint;
}

/**
 * Get complete swap quote with all details
 *
 * @param i - Input token index
 * @param j - Output token index
 * @param dx - Input amount
 * @param xp - Pool balances
 * @param Ann - A * A_PRECISION * N_COINS
 * @param baseFee - Base fee
 * @param feeMultiplier - Off-peg fee multiplier
 * @returns Complete swap quote
 */
export function quoteSwap(
  i: number,
  j: number,
  dx: bigint,
  xp: bigint[],
  Ann: bigint,
  baseFee: bigint,
  feeMultiplier: bigint
): SwapQuote {
  const spotPrice = getSpotPrice(i, j, xp, Ann);
  const amountOut = getDy(i, j, dx, xp, Ann, baseFee, feeMultiplier);

  // Calculate fee by comparing with no-fee output
  const D = getD(xp, Ann);
  const newXp = [...xp];
  newXp[i] = xp[i] + dx;
  const y = getY(i, j, newXp[i], xp, Ann, D);
  const dyBeforeFee = xp[j] - y - 1n;
  const fee = dyBeforeFee - amountOut;

  const effectivePrice = dx > 0n ? (amountOut * 10n ** 18n) / dx : 0n;
  const priceImpact = spotPrice > 0n
    ? ((spotPrice - effectivePrice) * 10000n) / spotPrice
    : 0n;

  return {
    amountOut,
    fee: fee > 0n ? fee : 0n,
    priceImpact: priceImpact > 0n ? priceImpact : 0n,
    effectivePrice,
    spotPrice,
  };
}

/**
 * Full liquidity quote with all relevant information
 */
export interface LiquidityQuote {
  /** LP tokens to mint/burn */
  lpTokens: bigint;
  /** Fee charged (in D terms) */
  fee: bigint;
  /** Price impact in basis points */
  priceImpact: bigint;
}

/**
 * Get complete add liquidity quote
 *
 * @param amounts - Amounts to deposit
 * @param xp - Pool balances
 * @param Ann - A * A_PRECISION * N_COINS
 * @param totalSupply - Total LP supply
 * @param fee - Base fee
 * @returns Complete liquidity quote
 */
export function quoteAddLiquidity(
  amounts: bigint[],
  xp: bigint[],
  Ann: bigint,
  totalSupply: bigint,
  fee: bigint
): LiquidityQuote {
  const lpTokens = calcTokenAmount(amounts, true, xp, Ann, totalSupply, fee);
  const feeAmount = calcTokenFee(amounts, xp, Ann, fee, true);

  // Calculate price impact by comparing to proportional deposit
  const D0 = getD(xp, Ann);
  const totalDeposit = amounts.reduce((a, b) => a + b, 0n);
  const proportionalLp = totalSupply > 0n
    ? (totalDeposit * totalSupply) / D0
    : totalDeposit;
  const priceImpact = proportionalLp > 0n
    ? ((proportionalLp - lpTokens) * 10000n) / proportionalLp
    : 0n;

  return {
    lpTokens,
    fee: feeAmount,
    priceImpact: priceImpact > 0n ? priceImpact : 0n,
  };
}

/**
 * Get complete remove liquidity quote (single-sided)
 *
 * @param tokenAmount - LP tokens to burn
 * @param i - Index of token to withdraw
 * @param xp - Pool balances
 * @param Ann - A * A_PRECISION * N_COINS
 * @param totalSupply - Total LP supply
 * @param fee - Base fee
 * @returns Complete liquidity quote
 */
export function quoteRemoveLiquidityOneCoin(
  tokenAmount: bigint,
  i: number,
  xp: bigint[],
  Ann: bigint,
  totalSupply: bigint,
  fee: bigint
): LiquidityQuote {
  const [amountOut, feeAmount] = calcWithdrawOneCoin(
    tokenAmount,
    i,
    xp,
    Ann,
    totalSupply,
    fee
  );

  // Calculate price impact by comparing to proportional share
  const proportionalAmount = (xp[i] * tokenAmount) / totalSupply;
  const priceImpact = proportionalAmount > 0n
    ? ((proportionalAmount - amountOut) * 10000n) / proportionalAmount
    : 0n;

  return {
    lpTokens: amountOut, // Using lpTokens field for output amount
    fee: feeAmount,
    priceImpact: priceImpact > 0n ? priceImpact : 0n,
  };
}

/**
 * Get output amount with slippage applied
 *
 * @param i - Input token index
 * @param j - Output token index
 * @param dx - Input amount
 * @param xp - Pool balances
 * @param Ann - A * A_PRECISION * N_COINS
 * @param baseFee - Base fee
 * @param feeMultiplier - Off-peg fee multiplier
 * @param slippageBps - Slippage tolerance in basis points
 * @returns [amountOut, minAmountOut]
 */
export function getAmountOut(
  i: number,
  j: number,
  dx: bigint,
  xp: bigint[],
  Ann: bigint,
  baseFee: bigint,
  feeMultiplier: bigint,
  slippageBps: number
): [bigint, bigint] {
  const amountOut = getDy(i, j, dx, xp, Ann, baseFee, feeMultiplier);
  const minAmountOut = (amountOut * BigInt(10000 - slippageBps)) / 10000n;
  return [amountOut, minAmountOut];
}

/**
 * Get input amount with slippage applied
 *
 * @param i - Input token index
 * @param j - Output token index
 * @param dy - Desired output amount
 * @param xp - Pool balances
 * @param Ann - A * A_PRECISION * N_COINS
 * @param baseFee - Base fee
 * @param feeMultiplier - Off-peg fee multiplier
 * @param slippageBps - Slippage tolerance in basis points
 * @returns [amountIn, maxAmountIn]
 */
export function getAmountIn(
  i: number,
  j: number,
  dy: bigint,
  xp: bigint[],
  Ann: bigint,
  baseFee: bigint,
  feeMultiplier: bigint,
  slippageBps: number
): [bigint, bigint] {
  const amountIn = getDx(i, j, dy, xp, Ann, baseFee, feeMultiplier);
  const maxAmountIn = (amountIn * BigInt(10000 + slippageBps)) / 10000n;
  return [amountIn, maxAmountIn];
}
