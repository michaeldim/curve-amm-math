/**
 * Curve Twocrypto-NG view quote path for pools using StableswapMath.
 *
 * Some Curve/YieldBasis pools expose the TwocryptoView interface, but their
 * MATH contract is Curve's `StableswapMath` compatibility contract. This
 * module mirrors TwocryptoView.get_dy:
 *
 * _get_dy_nofee -> StableswapMath.get_y -> fee_calc.
 */

import { A_MULTIPLIER, FEE_DENOMINATOR, PRECISION } from "./constants";
import { type TwocryptoParams } from "./cryptoswap";

const N_COINS = 2n;

export interface TwocryptoNgParams extends TwocryptoParams {
  /**
   * Pool immutable precisions as returned by Twocrypto.precisions().
   * Do not substitute token-decimal derived precisions unless they have been
   * verified against the pool contract.
   */
  precisions: [bigint, bigint];
}

export interface TwocryptoNgGetYResult {
  y: bigint;
  root: bigint;
}

export function getDy(params: TwocryptoNgParams, i: number, j: number, dx: bigint): bigint {
  if (i === j) return 0n;
  if (i < 0 || i > 1 || j < 0 || j > 1) return 0n;
  if (dx === 0n) return 0n;

  const xpRaw: [bigint, bigint] = [params.balances[0], params.balances[1]];
  xpRaw[i] += dx;

  const xp: [bigint, bigint] = [
    xpRaw[0] * params.precisions[0],
    (xpRaw[1] * params.priceScale * params.precisions[1]) / PRECISION,
  ];

  const yOut = getY(params.A, params.gamma, xp, params.D, j);
  if (yOut.y >= xp[j]) return 0n;

  let dy = xp[j] - yOut.y - 1n;
  if (dy <= 0n) return 0n;

  const xpAfter: [bigint, bigint] = [xp[0], xp[1]];
  xpAfter[j] = yOut.y;

  if (j > 0) {
    dy = (dy * PRECISION) / params.priceScale;
  }
  dy /= params.precisions[j];
  if (dy <= 0n) return 0n;

  const fee = feeCalc(xpAfter, params.midFee, params.outFee, params.feeGamma);
  dy -= (fee * dy) / FEE_DENOMINATOR;
  return dy > 0n ? dy : 0n;
}

export function getY(
  amp: bigint,
  _gamma: bigint,
  xp: [bigint, bigint],
  D: bigint,
  i: number
): TwocryptoNgGetYResult {
  if (i < 0 || i > 1) {
    throw new Error(`twocryptoNg.getY: index out of bounds (i=${i}, must be 0 or 1)`);
  }
  if (amp <= 0n) throw new Error("twocryptoNg.getY: amp cannot be zero");
  if (D <= 0n) throw new Error("twocryptoNg.getY: D cannot be zero");

  let sum = 0n;
  let c = D;
  const ann = amp * N_COINS;

  for (let coin = 0; coin < 2; coin++) {
    if (coin === i) continue;
    const x = xp[coin];
    if (x <= 0n) throw new Error("twocryptoNg.getY: zero paired balance");
    sum += x;
    c = (c * D) / (x * N_COINS);
  }

  c = (c * D * A_MULTIPLIER) / (ann * N_COINS);
  const b = sum + (D * A_MULTIPLIER) / ann;
  let y = D;

  for (let iter = 0; iter < 255; iter++) {
    const yPrev = y;
    y = (y * y + c) / (2n * y + b - D);
    const diff = y > yPrev ? y - yPrev : yPrev - y;
    if (diff <= 1n) {
      return { y, root: 0n };
    }
  }

  throw new Error("twocryptoNg.getY: did not converge");
}

export function feeCalc(
  xp: [bigint, bigint],
  midFee: bigint,
  outFee: bigint,
  feeGamma: bigint
): bigint {
  const balanceSum = xp[0] + xp[1];
  if (balanceSum === 0n) return midFee;

  let balanceTerm = (PRECISION * N_COINS ** N_COINS * xp[0]) / balanceSum;
  balanceTerm = (balanceTerm * xp[1]) / balanceSum;

  const denominator = (feeGamma * balanceTerm) / PRECISION + PRECISION - balanceTerm;
  if (denominator === 0n) return outFee;

  balanceTerm = (feeGamma * balanceTerm) / denominator;
  return (midFee * balanceTerm + outFee * (PRECISION - balanceTerm)) / PRECISION;
}
