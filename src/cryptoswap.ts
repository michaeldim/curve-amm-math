/**
 * Curve CryptoSwap (v2) Math
 *
 * Off-chain implementation of Curve CryptoSwap formulas for gas-free calculations.
 * Supports both Twocrypto-NG (2 coins) and Tricrypto-NG (3 coins).
 *
 * Based on the CryptoSwap invariant with A and gamma parameters.
 * The dynamic peg mechanism uses price_scale to adjust for token price divergence.
 *
 * References:
 * - Curve v2 whitepaper: https://curve.fi/files/crypto-pools-paper.pdf
 * - Twocrypto-NG source: https://github.com/curvefi/twocrypto-ng
 * - Tricrypto-NG source: https://github.com/curvefi/tricrypto-ng
 */

// Re-export constants from shared module
export {
  PRECISION,
  A_MULTIPLIER,
  FEE_DENOMINATOR,
  MAX_ITERATIONS,
  CONVERGENCE_THRESHOLD,
  MIN_CONVERGENCE,
  DERIVATIVE_EPSILON,
  BPS_DENOMINATOR,
} from "./constants";

import {
  PRECISION,
  A_MULTIPLIER,
  FEE_DENOMINATOR,
  MAX_ITERATIONS,
  CONVERGENCE_THRESHOLD,
  MIN_CONVERGENCE,
  DERIVATIVE_EPSILON,
  BPS_DENOMINATOR,
} from "./constants";

// ============================================
// Unified Pool Parameters Interface
// ============================================

/**
 * Base parameters shared by all CryptoSwap pools
 */
interface CryptoPoolParamsBase {
  /** Amplification parameter (on-chain A) */
  A: bigint;
  /** Gamma parameter for curvature */
  gamma: bigint;
  /** Current invariant D */
  D: bigint;
  /** Mid fee (fee when pool is balanced) */
  midFee: bigint;
  /** Out fee (fee when pool is imbalanced) */
  outFee: bigint;
  /** Fee gamma parameter for fee interpolation */
  feeGamma: bigint;
}

/**
 * Pool parameters for 2-coin CryptoSwap (Twocrypto-NG)
 */
export interface TwocryptoParams extends CryptoPoolParamsBase {
  /** Price scale for token 1 relative to token 0 */
  priceScale: bigint;
  /** Pool balances (unscaled, in token decimals) */
  balances: [bigint, bigint];
  /** Token precisions (10^(18-decimals) for each token) */
  precisions?: [bigint, bigint];
}

/**
 * Pool parameters for 3-coin CryptoSwap (Tricrypto-NG)
 */
export interface TricryptoParams extends CryptoPoolParamsBase {
  /** Price scales for tokens 1 and 2 relative to token 0 */
  priceScales: [bigint, bigint];
  /** Pool balances (unscaled, in token decimals) */
  balances: [bigint, bigint, bigint];
  /** Token precisions (10^(18-decimals) for each token) */
  precisions?: [bigint, bigint, bigint];
}

/** Backward-compatible alias */
export type CryptoSwapParams = TwocryptoParams;

// ============================================
// Core Math Functions
// ============================================

/**
 * Newton's method to find y in 2-coin CryptoSwap invariant
 * Direct translation from Curve v2 Vyper source: newton_y()
 *
 * @param A - Raw A parameter from pool
 * @param gamma - gamma parameter
 * @param x - scaled balances [x0, x1]
 * @param D - invariant D
 * @param i - index of the output token (the one we're solving for)
 */
export function newtonY(
  A: bigint,
  gamma: bigint,
  x: [bigint, bigint],
  D: bigint,
  i: number
): bigint {
  const N_COINS = 2n;

  // x_j is the other token's balance (not the one we're solving for)
  const x_j = x[1 - i];

  // Initial guess: y = D^2 / (x_j * N^2)
  let y = (D * D) / (x_j * N_COINS * N_COINS);

  // K0_i = (10^18 * N) * x_j / D
  const K0_i = (PRECISION * N_COINS * x_j) / D;

  // Convergence limit
  const convergence_limit = (() => {
    const a = x_j / CONVERGENCE_THRESHOLD;
    const b = D / CONVERGENCE_THRESHOLD;
    let max = a > b ? a : b;
    if (max < MIN_CONVERGENCE) max = MIN_CONVERGENCE;
    return max;
  })();

  for (let j = 0; j < MAX_ITERATIONS; j++) {
    const y_prev = y;

    // K0 = K0_i * y * N / D
    const K0 = (K0_i * y * N_COINS) / D;

    // S = x_j + y
    const S = x_j + y;

    // _g1k0 = |gamma + 10^18 - K0| + 1
    let _g1k0 = gamma + PRECISION;
    if (_g1k0 > K0) {
      _g1k0 = _g1k0 - K0 + 1n;
    } else {
      _g1k0 = K0 - _g1k0 + 1n;
    }

    // mul1 = 10^18 * D / gamma * _g1k0 / gamma * _g1k0 * A_MULTIPLIER / A
    const mul1 =
      (((((PRECISION * D) / gamma) * _g1k0) / gamma) * _g1k0 * A_MULTIPLIER) / A;

    // mul2 = 10^18 + (2 * 10^18) * K0 / _g1k0
    const mul2 = PRECISION + (2n * PRECISION * K0) / _g1k0;

    // yfprime = 10^18 * y + S * mul2 + mul1
    const yfprime_base = PRECISION * y + S * mul2 + mul1;

    // _dyfprime = D * mul2
    const _dyfprime = D * mul2;

    let yfprime: bigint;
    if (yfprime_base < _dyfprime) {
      y = y_prev / 2n;
      continue;
    } else {
      yfprime = yfprime_base - _dyfprime;
    }

    const fprime = yfprime / y;
    const y_minus_base = mul1 / fprime;
    const y_plus =
      (yfprime + PRECISION * D) / fprime + (y_minus_base * PRECISION) / K0;
    const y_minus = y_minus_base + (PRECISION * S) / fprime;

    if (y_plus < y_minus) {
      y = y_prev / 2n;
    } else {
      y = y_plus - y_minus;
    }

    const diff = y > y_prev ? y - y_prev : y_prev - y;
    const threshold = y / CONVERGENCE_THRESHOLD;
    if (diff < (convergence_limit > threshold ? convergence_limit : threshold)) {
      return y;
    }
  }

  return y;
}

/**
 * Newton's method to find y in 3-coin CryptoSwap invariant
 * Based on Tricrypto-NG Vyper source
 *
 * @param A - Raw A parameter from pool
 * @param gamma - gamma parameter
 * @param x - scaled balances [x0, x1, x2]
 * @param D - invariant D
 * @param i - index of the output token (the one we're solving for)
 */
export function newtonY3(
  A: bigint,
  gamma: bigint,
  x: [bigint, bigint, bigint],
  D: bigint,
  i: number
): bigint {
  const N_COINS = 3n;
  const N_COINS_POW = 27n; // 3^3

  // Sum and product of other balances (excluding i)
  let S = 0n;
  let prod = PRECISION;
  for (let k = 0; k < 3; k++) {
    if (k !== i) {
      S += x[k];
      prod = (prod * x[k]) / PRECISION;
    }
  }

  // Initial guess: y = D^3 / (N^N * prod(x_k for k != i))
  let y = (((D * D) / prod) * D) / (N_COINS_POW * PRECISION);

  // K0_i = (10^18 * N^(N-1)) * prod(x_k for k != i) / D^(N-1)
  // For N=3: K0_i = 9 * 10^18 * prod / D^2
  const K0_i = (PRECISION * 9n * prod) / ((D * D) / PRECISION);

  // Convergence limit
  const convergence_limit = (() => {
    let max_val = D / CONVERGENCE_THRESHOLD;
    for (let k = 0; k < 3; k++) {
      if (k !== i) {
        const val = x[k] / CONVERGENCE_THRESHOLD;
        if (val > max_val) max_val = val;
      }
    }
    if (max_val < MIN_CONVERGENCE) max_val = MIN_CONVERGENCE;
    return max_val;
  })();

  for (let j = 0; j < MAX_ITERATIONS; j++) {
    const y_prev = y;

    // K0 = K0_i * y * N / D
    const K0 = (K0_i * y * N_COINS) / D;

    // S_total = S + y
    const S_total = S + y;

    // _g1k0 = |gamma + 10^18 - K0| + 1
    let _g1k0 = gamma + PRECISION;
    if (_g1k0 > K0) {
      _g1k0 = _g1k0 - K0 + 1n;
    } else {
      _g1k0 = K0 - _g1k0 + 1n;
    }

    // mul1 = 10^18 * D / gamma * _g1k0 / gamma * _g1k0 * A_MULTIPLIER / A
    const mul1 =
      (((((PRECISION * D) / gamma) * _g1k0) / gamma) * _g1k0 * A_MULTIPLIER) / A;

    // mul2 = 10^18 + (2 * 10^18) * K0 / _g1k0
    const mul2 = PRECISION + (2n * PRECISION * K0) / _g1k0;

    const yfprime_base = PRECISION * y + S_total * mul2 + mul1;
    const _dyfprime = D * mul2;

    let yfprime: bigint;
    if (yfprime_base < _dyfprime) {
      y = y_prev / 2n;
      continue;
    } else {
      yfprime = yfprime_base - _dyfprime;
    }

    const fprime = yfprime / y;
    const y_minus_base = mul1 / fprime;
    const y_plus =
      (yfprime + PRECISION * D) / fprime + (y_minus_base * PRECISION) / K0;
    const y_minus = y_minus_base + (PRECISION * S_total) / fprime;

    if (y_plus < y_minus) {
      y = y_prev / 2n;
    } else {
      y = y_plus - y_minus;
    }

    const diff = y > y_prev ? y - y_prev : y_prev - y;
    const threshold = y / CONVERGENCE_THRESHOLD;
    if (diff < (convergence_limit > threshold ? convergence_limit : threshold)) {
      return y;
    }
  }

  return y;
}

/**
 * Calculate D invariant for N-coin CryptoSwap using Newton's method
 *
 * @param A - Amplification parameter
 * @param gamma - Gamma parameter
 * @param xp - Scaled balances
 * @returns D invariant
 */
export function calcD(A: bigint, gamma: bigint, xp: bigint[]): bigint {
  const N = BigInt(xp.length);
  const N_POW = N ** N;

  let S = 0n;
  for (const x of xp) {
    S += x;
  }
  if (S === 0n) return 0n;

  let D = S;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const D_prev = D;

    // K0 = N^N * prod(x) * PRECISION / D^N
    let K0 = N_POW * PRECISION;
    for (const x of xp) {
      K0 = (K0 * x) / D;
    }

    // _g1k0 = |gamma + PRECISION - K0| + 1
    let _g1k0 = gamma + PRECISION;
    if (_g1k0 > K0) {
      _g1k0 = _g1k0 - K0 + 1n;
    } else {
      _g1k0 = K0 - _g1k0 + 1n;
    }

    const mul1 = (((((PRECISION * D) / gamma) * _g1k0) / gamma) * _g1k0 * A_MULTIPLIER) / A;
    const mul2 = (2n * PRECISION * K0) / _g1k0;

    const neg_fprime =
      S + (S * mul2) / PRECISION + (mul1 * N) / D - (PRECISION + mul2) * N;

    const D_plus = (D * (neg_fprime + S)) / neg_fprime;
    const D_minus = (D * D) / neg_fprime;

    if (D_plus > D_minus) {
      D = D_plus - D_minus;
    } else {
      D = (D_minus - D_plus) / 2n;
    }

    const diff = D > D_prev ? D - D_prev : D_prev - D;
    if (diff * CONVERGENCE_THRESHOLD < D) {
      return D;
    }
  }

  return D;
}

/**
 * Calculate dynamic fee for N-coin CryptoSwap pool
 *
 * @param xp - Scaled balances
 * @param feeGamma - Fee gamma parameter
 * @param midFee - Mid fee (balanced pool)
 * @param outFee - Out fee (imbalanced pool)
 * @returns Dynamic fee
 */
export function dynamicFee(
  xp: bigint[],
  feeGamma: bigint,
  midFee: bigint,
  outFee: bigint
): bigint {
  const N = BigInt(xp.length);
  const N_POW = N ** N;

  let sum = 0n;
  for (const x of xp) {
    sum += x;
  }
  if (sum === 0n) return midFee;

  // K = (PRECISION * N^N) * prod(xp) / sum^N
  let K = PRECISION * N_POW;
  for (const x of xp) {
    K = (K * x) / sum;
  }

  const f = (feeGamma * PRECISION) / (feeGamma + PRECISION - K);
  return (midFee * f + outFee * (PRECISION - f)) / PRECISION;
}

// ============================================
// Balance Scaling Functions
// ============================================

/**
 * Scale 2-coin balances to internal units
 */
export function scaleBalances(
  balances: [bigint, bigint],
  precisions: [bigint, bigint],
  priceScale: bigint
): [bigint, bigint] {
  return [
    balances[0] * precisions[0],
    (balances[1] * precisions[1] * priceScale) / PRECISION,
  ];
}

/**
 * Scale 3-coin balances to internal units
 */
export function scaleBalances3(
  balances: [bigint, bigint, bigint],
  precisions: [bigint, bigint, bigint],
  priceScales: [bigint, bigint]
): [bigint, bigint, bigint] {
  return [
    balances[0] * precisions[0],
    (balances[1] * precisions[1] * priceScales[0]) / PRECISION,
    (balances[2] * precisions[2] * priceScales[1]) / PRECISION,
  ];
}

/**
 * Unscale output amount based on token index (2-coin)
 */
function unscaleOutput2(
  dy: bigint,
  j: number,
  precisions: [bigint, bigint],
  priceScale: bigint
): bigint {
  if (j === 0) {
    return dy / precisions[0];
  }
  return (dy * PRECISION) / (precisions[1] * priceScale);
}

/**
 * Unscale output amount based on token index (3-coin)
 */
function unscaleOutput3(
  dy: bigint,
  j: number,
  precisions: [bigint, bigint, bigint],
  priceScales: [bigint, bigint]
): bigint {
  if (j === 0) {
    return dy / precisions[0];
  } else if (j === 1) {
    return (dy * PRECISION) / (precisions[1] * priceScales[0]);
  }
  return (dy * PRECISION) / (precisions[2] * priceScales[1]);
}

// ============================================
// Swap Functions (getDy, getDx)
// ============================================

/**
 * Off-chain implementation of Twocrypto get_dy
 */
export function getDy(
  params: TwocryptoParams,
  i: number,
  j: number,
  dx: bigint
): bigint {
  if (dx === 0n) return 0n;

  const { A, gamma, D, midFee, outFee, feeGamma, priceScale, balances } = params;
  const precisions = params.precisions ?? [1n, 1n];

  // Add dx to input token BEFORE scaling
  const newBalances: [bigint, bigint] = [balances[0], balances[1]];
  newBalances[i] = newBalances[i] + dx;

  // Scale to internal units
  const xp = scaleBalances(newBalances, precisions, priceScale);

  // Newton's method to find new y
  const y = newtonY(A, gamma, xp, D, j);

  // dy = xp[j] - y - 1
  let dy = xp[j] - y - 1n;
  if (dy < 0n) return 0n;

  // Update xp[j] for fee calculation
  const xp_after: [bigint, bigint] = [xp[0], xp[1]];
  xp_after[j] = y;

  // Convert dy back to external units
  dy = unscaleOutput2(dy, j, precisions, priceScale);

  // Apply dynamic fee
  const fee = dynamicFee(xp_after, feeGamma, midFee, outFee);
  dy = dy - (dy * fee) / FEE_DENOMINATOR;

  return dy;
}

/**
 * Off-chain implementation of Tricrypto get_dy
 */
export function getDy3(
  params: TricryptoParams,
  i: number,
  j: number,
  dx: bigint
): bigint {
  if (dx === 0n) return 0n;

  const { A, gamma, D, midFee, outFee, feeGamma, priceScales, balances } = params;
  const precisions = params.precisions ?? [1n, 1n, 1n];

  // Add dx to input token BEFORE scaling
  const newBalances: [bigint, bigint, bigint] = [...balances];
  newBalances[i] = newBalances[i] + dx;

  // Scale to internal units
  const xp = scaleBalances3(newBalances, precisions, priceScales);

  // Newton's method to find new y
  const y = newtonY3(A, gamma, xp, D, j);

  // dy = xp[j] - y - 1
  let dy = xp[j] - y - 1n;
  if (dy < 0n) return 0n;

  // Update xp[j] for fee calculation
  const xp_after: [bigint, bigint, bigint] = [...xp];
  xp_after[j] = y;

  // Convert dy back to external units
  dy = unscaleOutput3(dy, j, precisions, priceScales);

  // Apply dynamic fee
  const fee = dynamicFee(xp_after, feeGamma, midFee, outFee);
  dy = dy - (dy * fee) / FEE_DENOMINATOR;

  return dy;
}

/**
 * Calculate get_dx for 2-coin CryptoSwap (input needed for desired output)
 * Uses binary search for accuracy with dynamic fees
 */
export function getDx(
  params: TwocryptoParams,
  i: number,
  j: number,
  dy: bigint
): bigint {
  if (dy === 0n) return 0n;
  if (dy >= params.balances[j]) return 0n;

  let low = 0n;
  let high = params.balances[i] * 10n;
  const tolerance = dy / 10000n;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const mid = (low + high) / 2n;
    const dyCalc = getDy(params, i, j, mid);

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

/**
 * Calculate get_dx for 3-coin CryptoSwap (input needed for desired output)
 */
export function getDx3(
  params: TricryptoParams,
  i: number,
  j: number,
  dy: bigint
): bigint {
  if (dy === 0n) return 0n;
  if (dy >= params.balances[j]) return 0n;

  let low = 0n;
  let high = params.balances[i] * 10n;
  const tolerance = dy / 10000n;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const mid = (low + high) / 2n;
    const dyCalc = getDy3(params, i, j, mid);

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
// Peg Point Functions
// ============================================

/**
 * Find peg point for 2-coin pool
 */
export function findPegPoint(
  params: TwocryptoParams,
  i: number,
  j: number,
  precision: bigint = 10n * PRECISION
): bigint {
  const minAmount = PRECISION;
  const dyForMin = getDy(params, i, j, minAmount);
  if (dyForMin < minAmount) return 0n;

  const maxSwap = params.balances[0] + params.balances[1];
  let low = minAmount;
  let high = maxSwap;

  while (high - low > precision) {
    const mid = (low + high) / 2n;
    const dy = getDy(params, i, j, mid);
    if (dy >= mid) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

/**
 * Find peg point for 3-coin pool
 */
export function findPegPoint3(
  params: TricryptoParams,
  i: number,
  j: number,
  precision: bigint = 10n * PRECISION
): bigint {
  const minAmount = PRECISION;
  const dyForMin = getDy3(params, i, j, minAmount);
  if (dyForMin < minAmount) return 0n;

  let maxSwap = 0n;
  for (const bal of params.balances) {
    maxSwap += bal;
  }

  let low = minAmount;
  let high = maxSwap;

  while (high - low > precision) {
    const mid = (low + high) / 2n;
    const dy = getDy3(params, i, j, mid);
    if (dy >= mid) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

// ============================================
// Liquidity Functions
// ============================================

/**
 * Calculate LP tokens received for depositing amounts (2-coin)
 */
export function calcTokenAmount(
  params: TwocryptoParams,
  amounts: [bigint, bigint],
  totalSupply: bigint
): bigint {
  const precisions = params.precisions ?? [1n, 1n];

  const xp = scaleBalances(params.balances, precisions, params.priceScale);
  const D0 = calcD(params.A, params.gamma, xp);

  const newBalances: [bigint, bigint] = [
    params.balances[0] + amounts[0],
    params.balances[1] + amounts[1],
  ];
  const newXp = scaleBalances(newBalances, precisions, params.priceScale);
  const D1 = calcD(params.A, params.gamma, newXp);

  if (totalSupply === 0n) {
    return D1;
  }

  const diff = D1 - D0;
  return (totalSupply * diff) / D0;
}

/**
 * Calculate LP tokens received for depositing amounts (3-coin)
 */
export function calcTokenAmount3(
  params: TricryptoParams,
  amounts: [bigint, bigint, bigint],
  totalSupply: bigint
): bigint {
  const precisions = params.precisions ?? [1n, 1n, 1n];

  const xp = scaleBalances3(params.balances, precisions, params.priceScales);
  const D0 = calcD(params.A, params.gamma, xp);

  const newBalances: [bigint, bigint, bigint] = [
    params.balances[0] + amounts[0],
    params.balances[1] + amounts[1],
    params.balances[2] + amounts[2],
  ];
  const newXp = scaleBalances3(newBalances, precisions, params.priceScales);
  const D1 = calcD(params.A, params.gamma, newXp);

  if (totalSupply === 0n) {
    return D1;
  }

  const diff = D1 - D0;
  return (totalSupply * diff) / D0;
}

/**
 * Calculate tokens received for single-sided LP withdrawal (2-coin)
 */
export function calcWithdrawOneCoin(
  params: TwocryptoParams,
  tokenAmount: bigint,
  i: number,
  totalSupply: bigint
): bigint {
  const precisions = params.precisions ?? [1n, 1n];

  const xp = scaleBalances(params.balances, precisions, params.priceScale);
  const D0 = calcD(params.A, params.gamma, xp);
  const D1 = D0 - (tokenAmount * D0) / totalSupply;

  const newY = newtonY(params.A, params.gamma, xp, D1, i);

  let dy = xp[i] - newY;
  if (dy < 0n) return 0n;

  dy = unscaleOutput2(dy, i, precisions, params.priceScale);

  const fee = dynamicFee(xp, params.feeGamma, params.midFee, params.outFee);
  dy = dy - (dy * fee) / FEE_DENOMINATOR;

  return dy;
}

/**
 * Calculate tokens received for single-sided LP withdrawal (3-coin)
 */
export function calcWithdrawOneCoin3(
  params: TricryptoParams,
  tokenAmount: bigint,
  i: number,
  totalSupply: bigint
): bigint {
  const precisions = params.precisions ?? [1n, 1n, 1n];

  const xp = scaleBalances3(params.balances, precisions, params.priceScales);
  const D0 = calcD(params.A, params.gamma, xp);
  const D1 = D0 - (tokenAmount * D0) / totalSupply;

  const newY = newtonY3(params.A, params.gamma, xp, D1, i);

  let dy = xp[i] - newY;
  if (dy < 0n) return 0n;

  dy = unscaleOutput3(dy, i, precisions, params.priceScales);

  const fee = dynamicFee(xp, params.feeGamma, params.midFee, params.outFee);
  dy = dy - (dy * fee) / FEE_DENOMINATOR;

  return dy;
}

/**
 * Calculate balanced removal of liquidity (2-coin)
 */
export function calcRemoveLiquidity(
  params: TwocryptoParams,
  tokenAmount: bigint,
  totalSupply: bigint
): [bigint, bigint] {
  if (totalSupply === 0n) return [0n, 0n];
  return [
    (params.balances[0] * tokenAmount) / totalSupply,
    (params.balances[1] * tokenAmount) / totalSupply,
  ];
}

/**
 * Calculate balanced removal of liquidity (3-coin)
 */
export function calcRemoveLiquidity3(
  params: TricryptoParams,
  tokenAmount: bigint,
  totalSupply: bigint
): [bigint, bigint, bigint] {
  if (totalSupply === 0n) return [0n, 0n, 0n];
  return [
    (params.balances[0] * tokenAmount) / totalSupply,
    (params.balances[1] * tokenAmount) / totalSupply,
    (params.balances[2] * tokenAmount) / totalSupply,
  ];
}

// ============================================
// Price Functions
// ============================================

/**
 * Calculate virtual price of LP token (2-coin)
 */
export function getVirtualPrice(
  params: TwocryptoParams,
  totalSupply: bigint
): bigint {
  if (totalSupply === 0n) return PRECISION;
  const precisions = params.precisions ?? [1n, 1n];
  const xp = scaleBalances(params.balances, precisions, params.priceScale);
  const D = calcD(params.A, params.gamma, xp);
  return (D * PRECISION) / totalSupply;
}

/**
 * Calculate virtual price of LP token (3-coin)
 */
export function getVirtualPrice3(
  params: TricryptoParams,
  totalSupply: bigint
): bigint {
  if (totalSupply === 0n) return PRECISION;
  const precisions = params.precisions ?? [1n, 1n, 1n];
  const xp = scaleBalances3(params.balances, precisions, params.priceScales);
  const D = calcD(params.A, params.gamma, xp);
  return (D * PRECISION) / totalSupply;
}

/**
 * Calculate LP price in terms of token[0] (2-coin)
 */
export function lpPrice(
  params: TwocryptoParams,
  totalSupply: bigint
): bigint {
  if (totalSupply === 0n) return PRECISION;
  const precisions = params.precisions ?? [1n, 1n];

  const value0 = params.balances[0] * precisions[0];
  const value1 = (params.balances[1] * precisions[1] * params.priceScale) / PRECISION;
  const totalValue = value0 + value1;

  return (totalValue * PRECISION) / totalSupply;
}

/**
 * Calculate LP price in terms of token[0] (3-coin)
 */
export function lpPrice3(
  params: TricryptoParams,
  totalSupply: bigint
): bigint {
  if (totalSupply === 0n) return PRECISION;
  const precisions = params.precisions ?? [1n, 1n, 1n];

  const value0 = params.balances[0] * precisions[0];
  const value1 = (params.balances[1] * precisions[1] * params.priceScales[0]) / PRECISION;
  const value2 = (params.balances[2] * precisions[2] * params.priceScales[1]) / PRECISION;
  const totalValue = value0 + value1 + value2;

  return (totalValue * PRECISION) / totalSupply;
}

/**
 * Get spot price (2-coin)
 */
export function getSpotPrice(
  params: TwocryptoParams,
  i: number,
  j: number
): bigint {
  const dx = DERIVATIVE_EPSILON;
  const dy = getDy(params, i, j, dx);
  return (dy * PRECISION) / dx;
}

/**
 * Get spot price (3-coin)
 */
export function getSpotPrice3(
  params: TricryptoParams,
  i: number,
  j: number
): bigint {
  const dx = DERIVATIVE_EPSILON;
  const dy = getDy3(params, i, j, dx);
  return (dy * PRECISION) / dx;
}

/**
 * Get effective price for a swap (2-coin)
 */
export function getEffectivePrice(
  params: TwocryptoParams,
  i: number,
  j: number,
  dx: bigint
): bigint {
  if (dx === 0n) return getSpotPrice(params, i, j);
  const dy = getDy(params, i, j, dx);
  return (dy * PRECISION) / dx;
}

/**
 * Get effective price for a swap (3-coin)
 */
export function getEffectivePrice3(
  params: TricryptoParams,
  i: number,
  j: number,
  dx: bigint
): bigint {
  if (dx === 0n) return getSpotPrice3(params, i, j);
  const dy = getDy3(params, i, j, dx);
  return (dy * PRECISION) / dx;
}

/**
 * Calculate price impact for a swap (2-coin)
 */
export function getPriceImpact(
  params: TwocryptoParams,
  i: number,
  j: number,
  dx: bigint
): bigint {
  const spotPrice = getSpotPrice(params, i, j);
  const effectivePrice = getEffectivePrice(params, i, j, dx);

  if (spotPrice === 0n) return 0n;
  const impact = ((spotPrice - effectivePrice) * BPS_DENOMINATOR) / spotPrice;
  return impact > 0n ? impact : 0n;
}

/**
 * Calculate price impact for a swap (3-coin)
 */
export function getPriceImpact3(
  params: TricryptoParams,
  i: number,
  j: number,
  dx: bigint
): bigint {
  const spotPrice = getSpotPrice3(params, i, j);
  const effectivePrice = getEffectivePrice3(params, i, j, dx);

  if (spotPrice === 0n) return 0n;
  const impact = ((spotPrice - effectivePrice) * BPS_DENOMINATOR) / spotPrice;
  return impact > 0n ? impact : 0n;
}

// ============================================
// Ramping Functions
// ============================================

/**
 * Calculate A and gamma during ramping
 */
export function getAGammaAtTime(
  initialA: bigint,
  futureA: bigint,
  initialGamma: bigint,
  futureGamma: bigint,
  initialTime: bigint,
  futureTime: bigint,
  currentTime: bigint
): [bigint, bigint] {
  if (currentTime >= futureTime) {
    return [futureA, futureGamma];
  }
  if (currentTime <= initialTime) {
    return [initialA, initialGamma];
  }

  const elapsed = currentTime - initialTime;
  const duration = futureTime - initialTime;

  const currentA = initialA > futureA
    ? initialA - ((initialA - futureA) * elapsed) / duration
    : initialA + ((futureA - initialA) * elapsed) / duration;

  const currentGamma = initialGamma > futureGamma
    ? initialGamma - ((initialGamma - futureGamma) * elapsed) / duration
    : initialGamma + ((futureGamma - initialGamma) * elapsed) / duration;

  return [currentA, currentGamma];
}

// ============================================
// Utility Wrappers
// ============================================

/**
 * Full swap quote
 */
export interface CryptoSwapQuote {
  amountOut: bigint;
  fee: bigint;
  priceImpact: bigint;
  effectivePrice: bigint;
  spotPrice: bigint;
}

/**
 * Get complete swap quote (2-coin)
 */
export function quoteSwap(
  params: TwocryptoParams,
  i: number,
  j: number,
  dx: bigint
): CryptoSwapQuote {
  const spotPrice = getSpotPrice(params, i, j);
  const amountOut = getDy(params, i, j, dx);
  const effectivePrice = dx > 0n ? (amountOut * PRECISION) / dx : 0n;
  const priceImpact = spotPrice > 0n
    ? ((spotPrice - effectivePrice) * BPS_DENOMINATOR) / spotPrice
    : 0n;

  const precisions = params.precisions ?? [1n, 1n];
  const xp = scaleBalances(params.balances, precisions, params.priceScale);
  const fee = dynamicFee(xp, params.feeGamma, params.midFee, params.outFee);
  const feeAmount = (amountOut * fee) / (FEE_DENOMINATOR - fee);

  return {
    amountOut,
    fee: feeAmount,
    priceImpact: priceImpact > 0n ? priceImpact : 0n,
    effectivePrice,
    spotPrice,
  };
}

/**
 * Get complete swap quote (3-coin)
 */
export function quoteSwap3(
  params: TricryptoParams,
  i: number,
  j: number,
  dx: bigint
): CryptoSwapQuote {
  const spotPrice = getSpotPrice3(params, i, j);
  const amountOut = getDy3(params, i, j, dx);
  const effectivePrice = dx > 0n ? (amountOut * PRECISION) / dx : 0n;
  const priceImpact = spotPrice > 0n
    ? ((spotPrice - effectivePrice) * BPS_DENOMINATOR) / spotPrice
    : 0n;

  const precisions = params.precisions ?? [1n, 1n, 1n];
  const xp = scaleBalances3(params.balances, precisions, params.priceScales);
  const fee = dynamicFee(xp, params.feeGamma, params.midFee, params.outFee);
  const feeAmount = (amountOut * fee) / (FEE_DENOMINATOR - fee);

  return {
    amountOut,
    fee: feeAmount,
    priceImpact: priceImpact > 0n ? priceImpact : 0n,
    effectivePrice,
    spotPrice,
  };
}

/**
 * Get output amount with slippage (2-coin)
 */
export function getAmountOut(
  params: TwocryptoParams,
  i: number,
  j: number,
  dx: bigint,
  slippageBps: number
): [bigint, bigint] {
  const amountOut = getDy(params, i, j, dx);
  const minAmountOut = (amountOut * BigInt(10000 - slippageBps)) / BPS_DENOMINATOR;
  return [amountOut, minAmountOut];
}

/**
 * Get output amount with slippage (3-coin)
 */
export function getAmountOut3(
  params: TricryptoParams,
  i: number,
  j: number,
  dx: bigint,
  slippageBps: number
): [bigint, bigint] {
  const amountOut = getDy3(params, i, j, dx);
  const minAmountOut = (amountOut * BigInt(10000 - slippageBps)) / BPS_DENOMINATOR;
  return [amountOut, minAmountOut];
}

/**
 * Get input amount with slippage (2-coin)
 */
export function getAmountIn(
  params: TwocryptoParams,
  i: number,
  j: number,
  dy: bigint,
  slippageBps: number
): [bigint, bigint] {
  const amountIn = getDx(params, i, j, dy);
  const maxAmountIn = (amountIn * BigInt(10000 + slippageBps)) / BPS_DENOMINATOR;
  return [amountIn, maxAmountIn];
}

/**
 * Get input amount with slippage (3-coin)
 */
export function getAmountIn3(
  params: TricryptoParams,
  i: number,
  j: number,
  dy: bigint,
  slippageBps: number
): [bigint, bigint] {
  const amountIn = getDx3(params, i, j, dy);
  const maxAmountIn = (amountIn * BigInt(10000 + slippageBps)) / BPS_DENOMINATOR;
  return [amountIn, maxAmountIn];
}

/**
 * Calculate min output with slippage tolerance
 */
export function calculateMinDy(expectedOutput: bigint, slippageBps: number): string {
  const minDy = (expectedOutput * BigInt(10000 - slippageBps)) / BPS_DENOMINATOR;
  return minDy.toString();
}

/**
 * Calculate max input with slippage tolerance
 */
export function calculateMaxDx(expectedInput: bigint, slippageBps: number): string {
  const maxDx = (expectedInput * BigInt(10000 + slippageBps)) / BPS_DENOMINATOR;
  return maxDx.toString();
}

/**
 * Create default precisions for 18-decimal tokens (2-coin)
 */
export function defaultPrecisions(): [bigint, bigint] {
  return [1n, 1n];
}

/**
 * Create default precisions for 18-decimal tokens (3-coin)
 */
export function defaultPrecisions3(): [bigint, bigint, bigint] {
  return [1n, 1n, 1n];
}

// ============================================
// Legacy Aliases (for compatibility)
// ============================================

/** @deprecated Use calcD instead - calcD now handles any number of coins */
export const calcD3 = calcD;

/** @deprecated Use dynamicFee instead - dynamicFee now handles any number of coins */
export const dynamicFee3 = dynamicFee;
