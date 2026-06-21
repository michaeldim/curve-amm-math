/**
 * Curve LlamaLend LLAMMA math.
 *
 * Off-chain implementation of the quote path used by Curve's LlamaLend AMM
 * (`curve_stablecoin/AMM.vy`). Coin 0 is the borrowed token, typically crvUSD,
 * and coin 1 is the collateral token.
 *
 * The AMM stores per-band balances scaled by token precision multipliers
 * (`amount * precision`). Public `getDy`/`getDx` inputs and outputs use native
 * token decimals, matching the on-chain `get_dy` and `get_dx` methods.
 */

import { PRECISION } from "./constants";

export { PRECISION };

export const LLAMALEND_MAX_TICKS = 50;
export const LLAMALEND_MAX_SKIP_TICKS = 1024;

const WAD = PRECISION;

export type LlamaLendBandBalances =
  | ReadonlyMap<number, bigint>
  | Readonly<Record<number, bigint>>;

export interface LlamaLendAmmParams {
  /** Amplification coefficient from AMM.A(). */
  A: bigint;
  /** AMM fee in 1e18 precision. */
  fee: bigint;
  /** Current active band. */
  activeBand: number;
  /** Lowest band containing liquidity. */
  minBand: number;
  /** Highest band containing liquidity. */
  maxBand: number;
  /** Limited oracle price from AMM.price_oracle(), 1e18 precision. */
  pOracle: bigint;
  /** AMM.p_oracle_up(activeBand), 1e18 precision. */
  pOracleUp: bigint;
  /** bands_x values, already scaled by borrowedPrecision. */
  bandsX: LlamaLendBandBalances;
  /** bands_y values, already scaled by collateralPrecision. */
  bandsY: LlamaLendBandBalances;
  /** Borrowed token precision multiplier, defaults to 1 for 18 decimals. */
  borrowedPrecision?: bigint;
  /** Collateral token precision multiplier, defaults to 1 for 18 decimals. */
  collateralPrecision?: bigint;
  /** Optional override for `(A / (A - 1)) ** 50`, 1e18 precision. */
  maxOracleDnPow?: bigint;
}

export interface LlamaLendDetailedTrade {
  /** Input amount used, in native token decimals. */
  inAmount: bigint;
  /** Output amount received, in native token decimals. */
  outAmount: bigint;
  /** First band touched by the quote. */
  n1: number;
  /** Final band touched by the quote. */
  n2: number;
  /** Updated input-side band balances, in precision-scaled internal units. */
  ticksIn: bigint[];
  /** Remaining output-side balance in the final band, in precision-scaled units. */
  lastTickJ: bigint;
}

interface InternalDetailedTrade {
  inAmount: bigint;
  outAmount: bigint;
  n1: number;
  n2: number;
  ticksIn: bigint[];
  lastTickJ: bigint;
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

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function requireNonNegative(value: bigint, name: string): bigint {
  if (value < 0n) {
    throw new Error(`${name}: calculation underflowed`);
  }
  return value;
}

function ceilToPrecision(value: bigint, precision: bigint): bigint {
  assertUint(value, "value");
  assertPositive(precision, "precision");
  return ((value + precision - 1n) / precision) * precision;
}

function floorToPrecision(value: bigint, precision: bigint): bigint {
  assertUint(value, "value");
  assertPositive(precision, "precision");
  return (value / precision) * precision;
}

function getBandValue(bands: LlamaLendBandBalances, band: number): bigint {
  const maybeMap = bands as ReadonlyMap<number, bigint>;
  if (typeof maybeMap.get === "function") {
    return maybeMap.get(band) ?? 0n;
  }
  return (bands as Readonly<Record<number, bigint>>)[band] ?? 0n;
}

function emptyTrade(activeBand: number): InternalDetailedTrade {
  return {
    inAmount: 0n,
    outAmount: 0n,
    n1: activeBand,
    n2: activeBand,
    ticksIn: [],
    lastTickJ: 0n,
  };
}

/**
 * Integer square root, matching Vyper `isqrt` floor rounding.
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

/**
 * Compute Curve's constructor value for `(A / (A - 1)) ** 50`.
 */
export function computeMaxOracleDnPow(A: bigint): bigint {
  assertPositive(A, "A");
  if (A <= 1n) {
    throw new Error("A: value must be greater than 1");
  }

  const Aminus1 = A - 1n;
  let pow = WAD;
  for (let i = 0; i < LLAMALEND_MAX_TICKS; i++) {
    pow = (pow * A) / Aminus1;
  }
  return pow;
}

function validateParams(params: LlamaLendAmmParams): void {
  assertPositive(params.A, "A");
  if (params.A <= 1n) {
    throw new Error("A: value must be greater than 1");
  }
  assertUint(params.fee, "fee");
  if (params.fee >= WAD) {
    throw new Error("fee: value must be below 1e18");
  }
  assertPositive(params.pOracle, "pOracle");
  assertPositive(params.pOracleUp, "pOracleUp");
  assertPositive(params.borrowedPrecision ?? 1n, "borrowedPrecision");
  assertPositive(params.collateralPrecision ?? 1n, "collateralPrecision");
  assertPositive(params.maxOracleDnPow ?? computeMaxOracleDnPow(params.A), "maxOracleDnPow");
}

/**
 * Dynamic fee based on distance between the current band and oracle price.
 */
export function getDynamicFee(
  A: bigint,
  pOracle: bigint,
  pOracleUp: bigint
): bigint {
  assertPositive(A, "A");
  if (A <= 1n) {
    throw new Error("A: value must be greater than 1");
  }
  assertPositive(pOracle, "pOracle");
  assertPositive(pOracleUp, "pOracleUp");

  const Aminus1 = A - 1n;
  const pCurrentDown = (((pOracle ** 2n) / pOracleUp) * pOracle) / pOracleUp;
  const pCurrentUp = (((pCurrentDown * A) / Aminus1) * A) / Aminus1;

  if (pOracle < pCurrentDown) {
    return ((pCurrentDown - pOracle) * (WAD / 4n)) / pCurrentDown;
  }
  if (pOracle > pCurrentUp) {
    return ((pOracle - pCurrentUp) * (WAD / 4n)) / pOracle;
  }
  return 0n;
}

/**
 * Calculate LLAMMA y0 for one band.
 */
export function getY0(
  A: bigint,
  x: bigint,
  y: bigint,
  pOracle: bigint,
  pOracleUp: bigint
): bigint {
  assertPositive(A, "A");
  if (A <= 1n) {
    throw new Error("A: value must be greater than 1");
  }
  assertUint(x, "x");
  assertUint(y, "y");
  assertPositive(pOracle, "pOracle");
  assertPositive(pOracleUp, "pOracleUp");

  const Aminus1 = A - 1n;
  let b = 0n;
  if (x !== 0n) {
    b = (pOracleUp * Aminus1 * x) / pOracle;
  }
  if (y !== 0n) {
    b += (((A * pOracle ** 2n) / pOracleUp) * y) / WAD;
  }
  if (x > 0n && y > 0n) {
    const discriminant = b ** 2n + (((4n * A * pOracle) * y) / WAD) * x;
    return ((b + isqrt(discriminant)) * WAD) / (2n * A * pOracle);
  }
  return (b * WAD) / (A * pOracle);
}

function calcSwapOut(
  params: LlamaLendAmmParams,
  pump: boolean,
  inAmount: bigint,
  inPrecision: bigint,
  outPrecision: bigint
): InternalDetailedTrade {
  const A = params.A;
  const Aminus1 = A - 1n;
  const maxOracleDnPow = params.maxOracleDnPow ?? computeMaxOracleDnPow(A);
  const out = emptyTrade(params.activeBand);
  let pOracleUp = params.pOracleUp;
  let x = getBandValue(params.bandsX, out.n2);
  let y = getBandValue(params.bandsY, out.n2);
  let inAmountLeft = inAmount;
  const baseFee = params.fee;
  let tickIndex: number | null = null;

  for (let i = 0; i < LLAMALEND_MAX_TICKS + LLAMALEND_MAX_SKIP_TICKS; i++) {
    let f = 0n;
    let g = 0n;
    let invariant = 0n;
    let dynamicFee = baseFee;

    if (x > 0n || y > 0n) {
      if (tickIndex === null) {
        out.n1 = out.n2;
        tickIndex = 0;
      }
      const y0 = getY0(A, x, y, params.pOracle, pOracleUp);
      f = (((A * y0 * params.pOracle) / pOracleUp) * params.pOracle) / WAD;
      g = (Aminus1 * y0 * pOracleUp) / params.pOracle;
      invariant = (f + x) * (g + y);
      dynamicFee = max(getDynamicFee(A, params.pOracle, pOracleUp), baseFee);
    }

    const antifee = WAD ** 2n / (WAD - min(dynamicFee, WAD - 1n));

    if (tickIndex !== null) {
      out.ticksIn.push(pump ? x : y);
    }

    const pRatio = (pOracleUp * WAD) / params.pOracle;

    if (pump) {
      if (y !== 0n && g !== 0n) {
        let xDest = requireNonNegative(invariant / g - f - x, "calcSwapOut.xDest");
        let dx = (xDest * antifee) / WAD;
        if (dx >= inAmountLeft) {
          xDest = (inAmountLeft * WAD) / antifee;
          const lastTick = requireNonNegative(
            invariant / (f + x + xDest) - g + 1n,
            "calcSwapOut.lastTickJ"
          );
          out.lastTickJ = min(lastTick, y);
          x += inAmountLeft;
          out.outAmount += y - out.lastTickJ;
          out.ticksIn[tickIndex!] = x;
          out.inAmount = inAmount;
          break;
        }

        dx = max(dx, 1n);
        inAmountLeft -= dx;
        out.ticksIn[tickIndex!] = x + dx;
        out.inAmount += dx;
        out.outAmount += y;
      }

      if (i !== LLAMALEND_MAX_TICKS + LLAMALEND_MAX_SKIP_TICKS - 1) {
        if (out.n2 === params.maxBand) break;
        if (tickIndex === LLAMALEND_MAX_TICKS - 1) break;
        if (pRatio < WAD ** 2n / maxOracleDnPow) break;
        out.n2 += 1;
        pOracleUp = (pOracleUp * Aminus1) / A;
        x = 0n;
        y = getBandValue(params.bandsY, out.n2);
      }
    } else {
      if (x !== 0n && f !== 0n) {
        let yDest = requireNonNegative(invariant / f - g - y, "calcSwapOut.yDest");
        let dy = (yDest * antifee) / WAD;
        if (dy >= inAmountLeft) {
          yDest = (inAmountLeft * WAD) / antifee;
          const lastTick = requireNonNegative(
            invariant / (g + y + yDest) - f + 1n,
            "calcSwapOut.lastTickJ"
          );
          out.lastTickJ = min(lastTick, x);
          y += inAmountLeft;
          out.outAmount += x - out.lastTickJ;
          out.ticksIn[tickIndex!] = y;
          out.inAmount = inAmount;
          break;
        }

        dy = max(dy, 1n);
        inAmountLeft -= dy;
        out.ticksIn[tickIndex!] = y + dy;
        out.inAmount += dy;
        out.outAmount += x;
      }

      if (i !== LLAMALEND_MAX_TICKS + LLAMALEND_MAX_SKIP_TICKS - 1) {
        if (out.n2 === params.minBand) break;
        if (tickIndex === LLAMALEND_MAX_TICKS - 1) break;
        if (pRatio > maxOracleDnPow) break;
        out.n2 -= 1;
        pOracleUp = (pOracleUp * A) / Aminus1;
        x = getBandValue(params.bandsX, out.n2);
        y = 0n;
      }
    }

    if (tickIndex !== null) {
      tickIndex += 1;
    }
  }

  out.inAmount = ceilToPrecision(out.inAmount, inPrecision);
  out.outAmount = floorToPrecision(out.outAmount, outPrecision);
  return out;
}

function calcSwapIn(
  params: LlamaLendAmmParams,
  pump: boolean,
  outAmount: bigint,
  inPrecision: bigint,
  outPrecision: bigint
): InternalDetailedTrade {
  const A = params.A;
  const Aminus1 = A - 1n;
  const maxOracleDnPow = params.maxOracleDnPow ?? computeMaxOracleDnPow(A);
  const out = emptyTrade(params.activeBand);
  let pOracleUp = params.pOracleUp;
  let x = getBandValue(params.bandsX, out.n2);
  let y = getBandValue(params.bandsY, out.n2);
  let outAmountLeft = outAmount;
  const baseFee = params.fee;
  let tickIndex: number | null = null;

  for (let i = 0; i < LLAMALEND_MAX_TICKS + LLAMALEND_MAX_SKIP_TICKS; i++) {
    let f = 0n;
    let g = 0n;
    let invariant = 0n;
    let dynamicFee = baseFee;

    if (x > 0n || y > 0n) {
      if (tickIndex === null) {
        out.n1 = out.n2;
        tickIndex = 0;
      }
      const y0 = getY0(A, x, y, params.pOracle, pOracleUp);
      f = (((A * y0 * params.pOracle) / pOracleUp) * params.pOracle) / WAD;
      g = (Aminus1 * y0 * pOracleUp) / params.pOracle;
      invariant = (f + x) * (g + y);
      dynamicFee = max(getDynamicFee(A, params.pOracle, pOracleUp), baseFee);
    }

    const antifee = WAD ** 2n / (WAD - min(dynamicFee, WAD - 1n));

    if (tickIndex !== null) {
      out.ticksIn.push(pump ? x : y);
    }

    const pRatio = (pOracleUp * WAD) / params.pOracle;

    if (pump) {
      if (y !== 0n && g !== 0n) {
        if (y >= outAmountLeft) {
          out.lastTickJ = y - outAmountLeft;
          const xDest = requireNonNegative(
            invariant / (g + out.lastTickJ) - f - x,
            "calcSwapIn.xDest"
          );
          const dx = (xDest * antifee) / WAD;
          out.outAmount = outAmount;
          out.inAmount += dx;
          out.ticksIn[tickIndex!] = x + dx;
          break;
        }

        const xDest = requireNonNegative(invariant / g - f - x, "calcSwapIn.xDest");
        const dx = max((xDest * antifee) / WAD, 1n);
        outAmountLeft -= y;
        out.inAmount += dx;
        out.outAmount += y;
        out.ticksIn[tickIndex!] = x + dx;
      }

      if (i !== LLAMALEND_MAX_TICKS + LLAMALEND_MAX_SKIP_TICKS - 1) {
        if (out.n2 === params.maxBand) break;
        if (tickIndex === LLAMALEND_MAX_TICKS - 1) break;
        if (pRatio < WAD ** 2n / maxOracleDnPow) break;
        out.n2 += 1;
        pOracleUp = (pOracleUp * Aminus1) / A;
        x = 0n;
        y = getBandValue(params.bandsY, out.n2);
      }
    } else {
      if (x !== 0n && f !== 0n) {
        if (x >= outAmountLeft) {
          out.lastTickJ = x - outAmountLeft;
          const yDest = requireNonNegative(
            invariant / (f + out.lastTickJ) - g - y,
            "calcSwapIn.yDest"
          );
          const dy = (yDest * antifee) / WAD;
          out.outAmount = outAmount;
          out.inAmount += dy;
          out.ticksIn[tickIndex!] = y + dy;
          break;
        }

        const yDest = requireNonNegative(invariant / f - g - y, "calcSwapIn.yDest");
        const dy = max((yDest * antifee) / WAD, 1n);
        outAmountLeft -= x;
        out.inAmount += dy;
        out.outAmount += x;
        out.ticksIn[tickIndex!] = y + dy;
      }

      if (i !== LLAMALEND_MAX_TICKS + LLAMALEND_MAX_SKIP_TICKS - 1) {
        if (out.n2 === params.minBand) break;
        if (tickIndex === LLAMALEND_MAX_TICKS - 1) break;
        if (pRatio > maxOracleDnPow) break;
        out.n2 -= 1;
        pOracleUp = (pOracleUp * A) / Aminus1;
        x = getBandValue(params.bandsX, out.n2);
        y = 0n;
      }
    }

    if (tickIndex !== null) {
      tickIndex += 1;
    }
  }

  out.inAmount = ceilToPrecision(out.inAmount, inPrecision);
  out.outAmount = floorToPrecision(out.outAmount, outPrecision);
  return out;
}

function convertTrade(
  trade: InternalDetailedTrade,
  inPrecision: bigint,
  outPrecision: bigint
): LlamaLendDetailedTrade {
  return {
    ...trade,
    inAmount: trade.inAmount / inPrecision,
    outAmount: trade.outAmount / outPrecision,
  };
}

/**
 * Full exact-input quote, matching AMM.get_dxdy(..., is_in=True).
 */
export function quote(
  params: LlamaLendAmmParams,
  i: number,
  j: number,
  inAmount: bigint
): LlamaLendDetailedTrade {
  if (!((i === 0 && j === 1) || (i === 1 && j === 0))) {
    return convertTrade(emptyTrade(params.activeBand), 1n, 1n);
  }
  if (inAmount === 0n) {
    return convertTrade(emptyTrade(params.activeBand), 1n, 1n);
  }
  assertUint(inAmount, "inAmount");
  validateParams(params);

  let inPrecision = params.collateralPrecision ?? 1n;
  let outPrecision = params.borrowedPrecision ?? 1n;
  if (i === 0) {
    inPrecision = params.borrowedPrecision ?? 1n;
    outPrecision = params.collateralPrecision ?? 1n;
  }

  const trade = calcSwapOut(
    params,
    i === 0,
    inAmount * inPrecision,
    inPrecision,
    outPrecision
  );
  return convertTrade(trade, inPrecision, outPrecision);
}

/**
 * Full exact-output quote, matching AMM.get_dydx(..., is_in=False).
 */
export function quoteExactOut(
  params: LlamaLendAmmParams,
  i: number,
  j: number,
  outAmount: bigint
): LlamaLendDetailedTrade {
  if (!((i === 0 && j === 1) || (i === 1 && j === 0))) {
    return convertTrade(emptyTrade(params.activeBand), 1n, 1n);
  }
  if (outAmount === 0n) {
    return convertTrade(emptyTrade(params.activeBand), 1n, 1n);
  }
  assertUint(outAmount, "outAmount");
  validateParams(params);

  let inPrecision = params.collateralPrecision ?? 1n;
  let outPrecision = params.borrowedPrecision ?? 1n;
  if (i === 0) {
    inPrecision = params.borrowedPrecision ?? 1n;
    outPrecision = params.collateralPrecision ?? 1n;
  }

  const trade = calcSwapIn(
    params,
    i === 0,
    outAmount * outPrecision,
    inPrecision,
    outPrecision
  );
  return convertTrade(trade, inPrecision, outPrecision);
}

/**
 * Output amount for an exact-input LlamaLend AMM swap.
 */
export function getDy(
  params: LlamaLendAmmParams,
  i: number,
  j: number,
  inAmount: bigint
): bigint {
  return quote(params, i, j, inAmount).outAmount;
}

/**
 * Input amount required for an exact-output LlamaLend AMM swap.
 *
 * Returns 0 when the requested output is unavailable.
 */
export function getDx(
  params: LlamaLendAmmParams,
  i: number,
  j: number,
  outAmount: bigint
): bigint {
  const trade = quoteExactOut(params, i, j, outAmount);
  return trade.outAmount === outAmount ? trade.inAmount : 0n;
}

/**
 * Effective output/input price in 1e18 precision for an exact-input quote.
 */
export function getEffectivePrice(
  params: LlamaLendAmmParams,
  i: number,
  j: number,
  inAmount: bigint
): bigint {
  if (inAmount === 0n) return 0n;
  return (getDy(params, i, j, inAmount) * WAD) / inAmount;
}
