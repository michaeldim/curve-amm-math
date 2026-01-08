# curve-amm-math

Off-chain TypeScript implementations of Curve AMM math for gas-free calculations.

[![npm version](https://badge.fury.io/js/curve-amm-math.svg)](https://www.npmjs.com/package/curve-amm-math)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **StableSwap math** - For pegged asset pools (stablecoins, liquid staking tokens)
- **CryptoSwap math** - For volatile asset pairs (Twocrypto-NG, Tricrypto-NG)
- **Zero dependencies** - Pure TypeScript with native BigInt
- **Browser compatible** - Works in Node.js and browsers (ES2020+)
- **Optional RPC utilities** - Fetch pool parameters via JSON-RPC (requires `viem`)
- **Generalized for N coins** - Works with 2-8 coin StableSwap, 2-3 coin CryptoSwap

## Installation

```bash
npm install curve-amm-math
# or
pnpm add curve-amm-math
# or
yarn add curve-amm-math
```

For RPC utilities:
```bash
npm install curve-amm-math viem
```

## Usage

### StableSwap (pegged assets)

```typescript
import { stableswap } from 'curve-amm-math';

// Pool parameters
const balances = [1000n * 10n**18n, 1100n * 10n**18n];
const Ann = stableswap.computeAnn(100n, 2);  // A=100, 2 coins
const baseFee = 4000000n;                     // 0.04%
const feeMultiplier = 2n * 10n**10n;          // 2x off-peg multiplier
const totalSupply = 2100n * 10n**18n;         // LP token supply

// Swap quotes
const dy = stableswap.getDy(0, 1, 10n * 10n**18n, balances, Ann, baseFee, feeMultiplier);
const dx = stableswap.getDx(0, 1, 10n * 10n**18n, balances, Ann, baseFee, feeMultiplier);

// Price analysis
const spotPrice = stableswap.getSpotPrice(0, 1, balances, Ann);
const effectivePrice = stableswap.getEffectivePrice(0, 1, 10n * 10n**18n, balances, Ann, baseFee, feeMultiplier);
const priceImpact = stableswap.getPriceImpact(0, 1, 10n * 10n**18n, balances, Ann, baseFee, feeMultiplier);

// Liquidity operations
const lpTokens = stableswap.calcTokenAmount([5n * 10n**18n, 5n * 10n**18n], true, balances, Ann, totalSupply, baseFee);
const [withdrawn, fee] = stableswap.calcWithdrawOneCoin(lpTokens, 0, balances, Ann, totalSupply, baseFee);
const proportional = stableswap.calcRemoveLiquidity(lpTokens, balances, totalSupply);

// Pool metrics
const virtualPrice = stableswap.getVirtualPrice(balances, Ann, totalSupply);
```

### CryptoSwap (volatile assets)

```typescript
import { cryptoswap } from 'curve-amm-math';

// 2-coin pool (Twocrypto-NG)
const params: cryptoswap.TwocryptoParams = {
  A: 400000n,
  gamma: 145000000000000n,
  D: 2000000000000000000000n,
  midFee: 3000000n,
  outFee: 30000000n,
  feeGamma: 230000000000000n,
  priceScale: 1000000000000000000n,
  balances: [1000n * 10n**18n, 1000n * 10n**18n],
  precisions: [1n, 1n],
};

const dy = cryptoswap.getDy(params, 0, 1, 10n * 10n**18n);
const lpPrice = cryptoswap.lpPrice(params, totalSupply);

// 3-coin pool (Tricrypto-NG)
const params3: cryptoswap.TricryptoParams = {
  A: 2700n,
  gamma: 1300000000000n,
  D: 30000000n * 10n**18n,
  midFee: 1000000n,
  outFee: 45000000n,
  feeGamma: 5000000000000000n,
  priceScales: [30000n * 10n**18n, 2000n * 10n**18n], // ETH, BTC prices in USD
  balances: [1000n * 10n**18n, 33n * 10n**18n, 500n * 10n**18n],
  precisions: [1n, 1n, 1n],
};

const dy3 = cryptoswap.getDy3(params3, 0, 1, 10n * 10n**18n);
const lpPrice3 = cryptoswap.lpPrice3(params3, totalSupply);
```

### RPC Utilities (optional)

```typescript
import { stableswap, cryptoswap } from 'curve-amm-math';
import { getStableSwapParams, getCryptoSwapParams, getOnChainDy } from 'curve-amm-math/rpc';

const rpcUrl = 'https://eth.llamarpc.com';
const poolAddress = '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7'; // 3pool

// Fetch pool params from chain
const params = await getStableSwapParams(rpcUrl, poolAddress, 3);

// Calculate off-chain
const dyOffChain = stableswap.getDy(0, 1, 10n * 10n**18n, params.balances, params.Ann, params.fee, params.offpegFeeMultiplier);

// Verify against on-chain (for testing)
const dyOnChain = await getOnChainDy(rpcUrl, poolAddress, 0, 1, 10n * 10n**18n);
```

## API Reference

### StableSwap - Core Functions

| Function | Description |
|----------|-------------|
| `getD(xp, Ann)` | Calculate invariant D using Newton's method |
| `getY(i, j, x, xp, Ann, D)` | Calculate y given x and D |
| `getDy(i, j, dx, xp, Ann, baseFee, feeMultiplier)` | Swap output after fees |
| `getDx(i, j, dy, xp, Ann, baseFee, feeMultiplier)` | Input needed for desired output |
| `dynamicFee(xpi, xpj, baseFee, feeMultiplier)` | Dynamic fee based on balance |
| `computeAnn(A, nCoins, isAPrecise?)` | Convert A to Ann |

### StableSwap - Liquidity Functions

| Function | Description |
|----------|-------------|
| `calcTokenAmount(amounts, isDeposit, xp, Ann, totalSupply, fee)` | LP tokens for deposit/withdraw |
| `calcWithdrawOneCoin(lpAmount, i, xp, Ann, totalSupply, fee)` | Single-coin withdrawal amount |
| `calcRemoveLiquidity(lpAmount, balances, totalSupply)` | Proportional withdrawal |
| `calcRemoveLiquidityImbalance(amounts, xp, Ann, totalSupply, fee)` | LP tokens burned for exact amounts |

### StableSwap - Price Functions

| Function | Description |
|----------|-------------|
| `getVirtualPrice(xp, Ann, totalSupply)` | Virtual price of LP token |
| `getSpotPrice(i, j, xp, Ann)` | Instantaneous price without fees |
| `getEffectivePrice(i, j, dx, xp, Ann, baseFee, feeMultiplier)` | Actual price including fees and slippage |
| `getPriceImpact(i, j, dx, xp, Ann, baseFee, feeMultiplier)` | Price impact as basis points |
| `findPegPoint(i, j, xp, Ann, fee, feeMultiplier)` | Max amount with >= 1:1 rate |

### StableSwap - Advanced Functions

| Function | Description |
|----------|-------------|
| `calcTokenFee(amounts, xp, Ann, totalSupply, fee)` | Fee charged on imbalanced deposit |
| `getFeeAtBalance(xp, baseFee, feeMultiplier, targetBalance?)` | Fee at current pool state |
| `getAAtTime(A0, A1, t0, t1, currentTime)` | A parameter during ramping |
| `getDyUnderlying(metaI, metaJ, dx, metaParams)` | Metapool underlying swap |
| `quoteSwap(i, j, dx, xp, Ann, baseFee, feeMultiplier)` | Full swap quote with breakdown |
| `getAmountOut(i, j, dx, poolParams)` | Simplified output calculation |
| `getAmountIn(i, j, dy, poolParams)` | Simplified input calculation |

### CryptoSwap - Core Functions (2-coin)

| Function | Description |
|----------|-------------|
| `newtonY(A, gamma, x, D, i)` | Newton's method for CryptoSwap |
| `getDy(params, i, j, dx)` | Swap output after fees |
| `getDx(params, i, j, dy)` | Input needed for desired output |
| `dynamicFee(xp, feeGamma, midFee, outFee)` | K-based dynamic fee |
| `calcTokenAmount(params, amounts, totalSupply)` | LP tokens for deposit |
| `calcWithdrawOneCoin(params, lpAmount, i, totalSupply)` | Single-coin withdrawal |

### CryptoSwap - 3-coin Functions

| Function | Description |
|----------|-------------|
| `newtonY3(A, gamma, x, D, i)` | Newton's method for 3-coin |
| `getDy3(params, i, j, dx)` | 3-coin swap output |
| `getDx3(params, i, j, dy)` | 3-coin input calculation |
| `calcTokenAmount3(params, amounts, totalSupply)` | 3-coin LP calculation |
| `calcWithdrawOneCoin3(params, lpAmount, i, totalSupply)` | 3-coin single-coin withdrawal |

### CryptoSwap - Price Functions

| Function | Description |
|----------|-------------|
| `getVirtualPrice(params, totalSupply)` / `getVirtualPrice3(...)` | Virtual price of LP token |
| `lpPrice(params, totalSupply)` / `lpPrice3(...)` | LP token price in token 0 |
| `getSpotPrice(params, i, j)` / `getSpotPrice3(...)` | Instantaneous price |
| `getEffectivePrice(params, i, j, dx)` / `getEffectivePrice3(...)` | Actual price |
| `getPriceImpact(params, i, j, dx)` / `getPriceImpact3(...)` | Price impact (bps) |
| `findPegPoint(params, i, j)` | Max amount with >= 1:1 rate |
| `getAGammaAtTime(...)` | A/gamma during ramping |

### RPC Utilities

| Function | Description |
|----------|-------------|
| `getStableSwapParams(rpcUrl, pool, nCoins?)` | Fetch StableSwap pool params |
| `getCryptoSwapParams(rpcUrl, pool, nCoins?, precisions?)` | Fetch CryptoSwap pool params |
| `getOnChainDy(rpcUrl, pool, i, j, dx, factory?)` | On-chain get_dy for verification |
| `batchRpcCalls(rpcUrl, calls)` | Batched eth_call requests |

## Testing Accuracy

The math implementations are tested against known values. For production use with financial consequences, we recommend:

1. **Verify against on-chain**: Use `getOnChainDy()` to compare your off-chain calculations
2. **Add slippage tolerance**: Always use `calculateMinDy()` with appropriate slippage (e.g., 50-100 bps)
3. **Integration tests**: Run periodic checks against mainnet pools

```typescript
import { stableswap } from 'curve-amm-math';
import { getStableSwapParams, getOnChainDy } from 'curve-amm-math/rpc';

// Verify accuracy
const params = await getStableSwapParams(rpcUrl, pool);
const offChain = stableswap.getDy(0, 1, dx, params.balances, params.Ann, params.fee, params.offpegFeeMultiplier);
const onChain = await getOnChainDy(rpcUrl, pool, 0, 1, dx);

const diff = offChain > onChain ? offChain - onChain : onChain - offChain;
const tolerance = onChain / 10000n; // 0.01% tolerance
console.assert(diff <= tolerance, 'Off-chain calculation exceeds tolerance');
```

## Pool Type Reference

| Pool Type | Factory ID | Math Module | Coins |
|-----------|------------|-------------|-------|
| StableSwap (legacy) | Registry | `stableswap` | 2-4 |
| StableSwapNG | 12 | `stableswap` | 2-8 |
| Twocrypto-NG | 13 | `cryptoswap` | 2 |
| Tricrypto-NG | 11 | `cryptoswap` | 3 |

## References

- [StableSwap whitepaper](https://curve.fi/files/stableswap-paper.pdf)
- [CryptoSwap whitepaper](https://curve.fi/files/crypto-pools-paper.pdf)
- [RareSkills: Curve get_d get_y](https://www.rareskills.io/post/curve-get-d-get-y)
- [Curve Meta Registry](https://etherscan.io/address/0xF98B45FA17DE75FB1aD0e7aFD971b0ca00e379fC)

## License

MIT
