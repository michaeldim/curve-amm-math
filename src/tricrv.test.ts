import { describe, expect, it } from "vitest";
import * as stableswapExact from "./stableswap-exact";
import {
  createTriCrvParams,
  getDx,
  getDy,
  TRICRV_COINS,
  TRICRV_DECIMALS,
  TRICRV_POOL_ADDRESS,
  TRICRV_RATES,
} from "./tricrv";

describe("triCRV / classic 3pool helpers", () => {
  it("uses 3pool identity rather than Tricrypto-NG identity", () => {
    expect(TRICRV_POOL_ADDRESS).toBe("0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7");
    expect(TRICRV_COINS).toEqual(["DAI", "USDC", "USDT"]);
    expect(TRICRV_DECIMALS).toEqual([18, 6, 6]);
    expect(TRICRV_RATES).toEqual(stableswapExact.computeRates([18, 6, 6]));
  });

  it("wraps exact StableSwap quotes with native decimals", () => {
    const params = createTriCrvParams(
      [
        1_000_000n * 10n ** 18n,
        1_000_000n * 10n ** 6n,
        1_000_000n * 10n ** 6n,
      ],
      2000n,
      1_000_000n
    );

    const dx = 1000n * 10n ** 18n;
    expect(getDy(params, 0, 1, dx)).toBe(
      stableswapExact.getDyExact(0, 1, dx, params)
    );

    const dy = 100n * 10n ** 6n;
    expect(getDx(params, 0, 1, dy)).toBe(
      stableswapExact.getDxExact(0, 1, dy, params)
    );
  });
});
