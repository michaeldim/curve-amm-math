import { describe, expect, it } from "vitest";
import { getDy, getY, type TwocryptoNgParams } from "./twocrypto-ng";

describe("Twocrypto-NG StableswapMath view quotes", () => {
  const params: TwocryptoNgParams = {
    // YieldBasis WETH direct pool 0x6e5492F8ea2370844EE098A56DD88e1717e4A9C2
    // at block 25246688. Its MATH() is Curve StableswapMath v0.1.0.
    A: 25000n,
    gamma: 1000000000000000n,
    D: 55026147797825919994829056n,
    midFee: 60000000n,
    outFee: 220000000n,
    feeGamma: 1395000000000000n,
    priceScale: 2530240918039073109766n,
    balances: [15059233255897814745998565n, 16639212112473862981353n],
    precisions: [1n, 1n],
  };

  it("matches the deployed math contract get_y result", () => {
    const xp: [bigint, bigint] = [
      15059233255897814745998565n,
      42103745571830771155345045n,
    ];

    expect(getY(params.A, params.gamma, xp, params.D, 0).y).toBe(
      15057460366283693777110061n
    );
  });

  it("matches the deployed pool get_dy result", () => {
    expect(getDy(params, 1, 0, 1000000000000000000n)).toBe(
      1734022563265887112517n
    );
  });
});
