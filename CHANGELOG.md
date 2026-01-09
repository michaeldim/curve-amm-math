# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-08

### Added

- **StableSwap module** (`stableswap`)
  - `getD` - Calculate D invariant using Newton's method
  - `getY` - Calculate y given x values and D
  - `getDy` - Calculate expected output for a swap
  - `getDx` - Calculate required input for desired output
  - `calcTokenAmount` - Calculate LP tokens for deposit/withdrawal
  - `calcWithdrawOneCoin` - Calculate single-token withdrawal
  - `quoteSwap` - Full swap quote with fees and price impact
  - Metapool support with `getDyUnderlying` and `getDxUnderlying`

- **Exact precision StableSwap module** (`stableswapExact`)
  - Matches Curve Vyper contracts within ±1 unit
  - `getDyExact` and `getDxExact` for precise calculations
  - Support for oracle tokens (wstETH, cbETH) and ERC4626 tokens

- **CryptoSwap module** (`cryptoswap`)
  - 2-coin support (Twocrypto-NG)
  - 3-coin support (Tricrypto-NG)
  - Dynamic fee calculations
  - Price impact and slippage helpers
  - `validateParams` for parameter range validation

- **RPC utilities** (`curve-amm-math/rpc`)
  - `getStableSwapParams` - Fetch pool parameters via RPC
  - `getCryptoSwapParams` - Fetch CryptoSwap parameters
  - Helper functions for building calldata

- **Comprehensive documentation**
  - Module selection guide
  - Error handling behavior tables
  - Input limits for all pool types
  - Thread safety guarantees

- **Test suite**
  - 414 unit tests
  - Property-based fuzz testing with fast-check
  - Edge case coverage (extreme imbalances, tiny/huge amounts)

### Security

- Division-by-zero guards in all core math functions
- Newton's method convergence protection (MAX_ITERATIONS = 255)
- Input validation for slippage, indices, and pool parameters
- Comprehensive parameter range validation
