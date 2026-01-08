/**
 * Shared constants used across Curve AMM math implementations.
 *
 * These constants match the values used in Curve's Vyper contracts.
 */

// ============================================
// Precision Constants
// ============================================

/** Standard precision for 18-decimal tokens (1e18) */
export const PRECISION = 10n ** 18n;

/** Fee denominator - all fees are expressed as fractions of this (1e10) */
export const FEE_DENOMINATOR = 10n ** 10n;

/** A parameter precision multiplier for StableSwap */
export const A_PRECISION = 100n;

/** A parameter multiplier for CryptoSwap */
export const A_MULTIPLIER = 10000n;

// ============================================
// Iteration Limits
// ============================================

/** Maximum iterations for Newton's method convergence */
export const MAX_ITERATIONS = 255;

// ============================================
// Convergence Thresholds
// ============================================

/** Convergence threshold for Newton's method in CryptoSwap (1e14) */
export const CONVERGENCE_THRESHOLD = 10n ** 14n;

/** Minimum convergence limit to prevent infinite loops */
export const MIN_CONVERGENCE = 100n;

/** Epsilon for numerical derivatives (1e12) */
export const DERIVATIVE_EPSILON = 10n ** 12n;

// ============================================
// Basis Points
// ============================================

/** Basis points denominator (10000 = 100%) */
export const BPS_DENOMINATOR = 10000n;

/** Default slippage in basis points (100 = 1%) */
export const DEFAULT_SLIPPAGE_BPS = 100;

/** Minimum allowed slippage in basis points (10 = 0.1%) */
export const MIN_SLIPPAGE_BPS = 10;

/** Maximum allowed slippage in basis points (5000 = 50%) */
export const MAX_SLIPPAGE_BPS = 5000;
