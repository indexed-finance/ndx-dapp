import * as coingeckoQueries from "helpers/coingecko-queries";
import * as supgraphQueries from "helpers/subgraph-queries";
import * as topLevelActions from "./actions";
import { BigNumber } from "bignumber.js";
import {
  RegisteredCall,
  convert,
  createOnChainBatch,
  deserializeOffChainCall,
  serializeOffChainCall,
  serializeOnChainCall,
} from "helpers";
import { SLIPPAGE_RATE, SUBGRAPH_URL_UNISWAP } from "config";
import { Trade } from "@uniswap/sdk";
import {
  approveSpender,
  burnAndSwapForExactTokens,
  burnExactAndSwapForTokens,
  downwardSlippage,
  executeUniswapTrade,
  exitswapExternAmountOut,
  exitswapPoolAmountIn,
  joinPool,
  joinswapExternAmountIn,
  joinswapPoolAmountOut,
  multicall,
  normalizeInitialData,
  normalizeStakingData,
  swapExactAmountIn,
  swapExactAmountOut,
  swapExactTokensForTokensAndMint,
  swapTokensForTokensAndMintExact,
  upwardSlippage,
} from "ethereum";
import { batcherActions } from "./batcher";
import { cacheActions } from "./cache";
import { categoriesActions } from "./categories";
import { ethers, providers } from "ethers";
import { indexPoolsActions } from "./indexPools";
import { notification } from "antd";
import { selectors } from "./selectors";
import { settingsActions } from "./settings";
import { stakingActions } from "./staking";
import { tokensActions } from "./tokens";
import { userActions } from "./user";
import debounce from "lodash.debounce";
import type { AppThunk } from "./store";

// #region Provider
/**
 * A global reference to the provider (always) and signer (for end users) is established
 * and is accessible elsewhere.
 */
export let provider:
  | null
  | providers.Web3Provider
  | providers.JsonRpcProvider
  | providers.InfuraProvider = null;
export let signer: null | providers.JsonRpcSigner = null;

export const disconnectFromProvider = () => {
  provider = null;
  signer = null;
};

export function useProvider() {
  return [provider, signer];
}
// #endregion

type InitialzeOptions = {
  provider:
    | providers.Web3Provider
    | providers.JsonRpcProvider
    | providers.InfuraProvider;
  withSigner?: boolean;
  selectedAddress?: string;
};

/**
 * Since the handler can fire multiple times in quick succession,
 * we need to batch the calls to avoid unnecessary updates.
 */
const BLOCK_HANDLER_DEBOUNCE_RATE = 250;

const offChainActionPayloads = {
  retrieveCoingeckoData: (value: any) => actions.coingeckoDataLoaded(value),
  requestPoolTradesAndSwaps: (value: any) =>
    actions.poolTradesAndSwapsLoaded(value),
  requestStakingData: (value: any) => actions.stakingDataLoaded(value),
};

export const thunks = {
  /**
   *
   */
  initialize: (options: InitialzeOptions): AppThunk => async (
    dispatch,
    getState
  ) => {
    let selectedAddress = "";

    provider = options.provider;

    if (provider.blockNumber !== -1) {
      dispatch(actions.blockNumberChanged(provider.blockNumber));
      dispatch(actions.cachePurged());
    }

    if (options.withSigner) {
      signer = provider.getSigner();

      if (options.selectedAddress) {
        selectedAddress = options.selectedAddress;
      } else if (provider.connection.url === "metamask") {
        selectedAddress = (provider as any).provider.selectedAddress;
      } else {
        throw new Error("Unable to initialize without a selected address.");
      }
    }

    await provider.ready;

    dispatch(thunks.retrieveInitialData());

    if (selectedAddress) {
      dispatch(actions.userAddressSelected(selectedAddress));
    }

    /**
     * When the block number changes,
     * change the state so that batcher may process.
     */
    const debouncedBlockHandler = debounce((blockNumber) => {
      const blockNumberAtThisTime = selectors.selectBlockNumber(getState());

      if (blockNumber !== blockNumberAtThisTime) {
        dispatch(thunks.changeBlockNumber(blockNumber));
      }
    }, BLOCK_HANDLER_DEBOUNCE_RATE);

    provider.addListener("block", debouncedBlockHandler);
  },
  /**
   *
   */
  changeBlockNumber: (blockNumber: number): AppThunk => async (
    dispatch,
    getState
  ) => {
    const state = getState();
    const onChainBatch = selectors.selectOnChainBatch(state);
    const offChainBatch = selectors.selectOffChainBatch(state);

    dispatch(actions.blockNumberChanged(blockNumber));
    dispatch(thunks.sendOnChainBatch(onChainBatch));
    dispatch(thunks.sendOffChainBatch(offChainBatch));
  },
  /**
   *
   */
  retrieveInitialData: (): AppThunk => async (dispatch) => {
    if (provider) {
      const { chainId } = provider.network;
      const url = supgraphQueries.getUrl(chainId);
      const initial = await supgraphQueries.queryInitial(url);
      const formatted = normalizeInitialData(initial);

      dispatch(actions.subgraphDataLoaded(formatted));
    }

    dispatch(actions.requestStakingData());
  },
  retrieveCoingeckoDataForPool: (poolId: string): AppThunk => async (
    dispatch
  ) => dispatch(thunks.retrieveCoingeckoData(poolId)),
  retrieveCoingeckoDataForTokens: (...tokenIds: string[]): AppThunk => async (
    dispatch
  ) => dispatch(thunks.retrieveCoingeckoData(tokenIds)),
  retrieveCoingeckoData: (
    poolOrTokenIds: string | string[]
  ): AppThunk => async (dispatch, getState) => {
    const state = getState();
    const canRequest = selectors.selectCoingeckoRequestable(state);

    if (canRequest) {
      const tx = selectors.selectTranslator(state);
      const isPool = typeof poolOrTokenIds === "string";
      const pool = isPool ? (poolOrTokenIds as string) : null;
      const tokenIds = pool
        ? [...selectors.selectPoolTokenIds(state, pool), pool]
        : (poolOrTokenIds as string[]);

      try {
        const tokens = await coingeckoQueries.getStatsForTokens(tokenIds);

        if (!tokens)
          dispatch(
            actions.coingeckoDataLoaded({
              pool,
              tokens,
            })
          );
      } catch {
        dispatch(actions.coingeckoRequestFailed({ when: Date.now() }));

        notification.error({
          message: tx("ERROR"),
          description: tx("THERE_WAS_A_PROBLEM_LOADING_DATA_FROM_COINGECKO"),
        });
      }
    }
  },
  /**
   *
   * @param poolAddress -
   * @returns
   */
  requestPoolTradesAndSwaps: (poolAddress: string): AppThunk => async (
    dispatch
  ) => {
    if (provider) {
      const { chainId } = await provider.getNetwork();
      const url = supgraphQueries.getUrl(chainId);
      const [trades, swaps] = await Promise.all([
        supgraphQueries.queryTrades(SUBGRAPH_URL_UNISWAP, poolAddress),
        supgraphQueries.querySwaps(url, poolAddress),
      ]);

      dispatch(
        actions.poolTradesAndSwapsLoaded({ poolId: poolAddress, trades, swaps })
      );
    }
  },
  /**
   *
   * @returns
   */
  requestStakingData: (): AppThunk => async (dispatch) => {
    if (provider) {
      const { chainId } = provider.network;
      const url = supgraphQueries.getUrl(chainId);
      const staking = await supgraphQueries.queryStaking(url);
      const formatted = normalizeStakingData(staking);

      dispatch(actions.stakingDataLoaded(formatted));
    }
  },
  /**
   * @param spenderAddress - Address of the spender to approve
   * @param tokenAddress - ERC20 token address
   * @param exactAmount - Exact amount of tokens to allow spender to transfer
   */
  approveSpender: (
    spenderAddress: string,
    tokenAddress: string,
    exactAmount: string
  ): AppThunk => async () => {
    if (signer && tokenAddress) {
      try {
        await approveSpender(signer, spenderAddress, tokenAddress, exactAmount);
      } catch (err) {
        // Handle failed approval.
        console.log(err);
      }
    }
  },
  trade: (trade: Trade): AppThunk => async (_, getState) => {
    const state = getState();
    if (signer) {
      const userAddress = selectors.selectUserAddress(state);
      await executeUniswapTrade(signer, userAddress, trade);
    }
  },
  joinswapExternAmountIn: (
    indexPool: string,
    tokenIn: string,
    amountIn: BigNumber,
    minPoolAmountOut: BigNumber
  ): AppThunk => async () => {
    if (signer) {
      await joinswapExternAmountIn(
        signer,
        indexPool,
        tokenIn,
        amountIn,
        minPoolAmountOut
      );
    }
  },
  joinswapPoolAmountOut: (
    indexPool: string,
    tokenIn: string,
    poolAmountOut: BigNumber,
    maxAmountIn: BigNumber
  ): AppThunk => () => {
    if (signer) {
      joinswapPoolAmountOut(
        signer,
        indexPool,
        tokenIn,
        poolAmountOut,
        maxAmountIn
      );
    }
  },
  joinPool: (
    indexPool: string,
    poolAmountOut: BigNumber,
    maxAmountsIn: BigNumber[]
  ): AppThunk => async () => {
    if (signer) {
      await joinPool(signer, indexPool, poolAmountOut, maxAmountsIn);
    }
  },
  exitswapPoolAmountIn: (
    indexPool: string,
    tokenOut: string,
    poolAmountIn: BigNumber,
    minAmountOut: BigNumber
  ): AppThunk => async () => {
    if (signer) {
      await exitswapPoolAmountIn(
        signer,
        indexPool,
        tokenOut,
        poolAmountIn,
        minAmountOut
      );
    }
  },
  exitswapExternAmountOut: (
    indexPool: string,
    tokenOut: string,
    tokenAmountOut: BigNumber,
    maxPoolAmountIn: BigNumber
  ): AppThunk => async () => {
    if (signer) {
      await exitswapExternAmountOut(
        signer,
        indexPool,
        tokenOut,
        tokenAmountOut,
        maxPoolAmountIn
      );
    }
  },
  swapExactAmountIn: (
    indexPool: string,
    tokenIn: string,
    amountIn: BigNumber,
    tokenOut: string,
    minAmountOut: BigNumber,
    maximumPrice: BigNumber
  ): AppThunk => async () => {
    if (signer) {
      await swapExactAmountIn(
        signer,
        indexPool,
        tokenIn,
        tokenOut,
        amountIn,
        minAmountOut,
        maximumPrice
      );
    }
  },
  swapExactAmountOut: (
    indexPool: string,
    tokenIn: string,
    maxAmountIn: BigNumber,
    tokenOut: string,
    amountOut: BigNumber,
    maximumPrice: BigNumber
  ): AppThunk => async () => {
    if (signer) {
      await swapExactAmountOut(
        signer,
        indexPool,
        tokenIn,
        tokenOut,
        maxAmountIn,
        amountOut,
        maximumPrice
      );
    }
  },
  swapTokensForTokensAndMintExact: (
    indexPool: string,
    maxAmountIn: BigNumber,
    path: string[],
    poolAmountOut: BigNumber
  ): AppThunk => async () => {
    if (signer) {
      await swapTokensForTokensAndMintExact(
        signer,
        indexPool,
        maxAmountIn,
        path,
        poolAmountOut
      );
    }
  },
  swapExactTokensForTokensAndMint: (
    indexPool: string,
    amountIn: BigNumber,
    path: string[],
    minPoolAmountOut: BigNumber
  ): AppThunk => async () => {
    if (signer) {
      await swapExactTokensForTokensAndMint(
        signer,
        indexPool,
        amountIn,
        path,
        minPoolAmountOut
      );
    }
  },
  burnExactAndSwapForTokens: (
    indexPool: string,
    poolAmountIn: BigNumber,
    path: string[],
    minAmountOut: BigNumber
  ): AppThunk => async () => {
    if (signer) {
      await burnExactAndSwapForTokens(
        signer,
        indexPool,
        poolAmountIn,
        path,
        minAmountOut
      );
    }
  },
  burnAndSwapForExactTokens: (
    indexPool: string,
    poolAmountInMax: BigNumber,
    path: string[],
    tokenAmountOut: BigNumber
  ): AppThunk => async () => {
    if (signer) {
      await burnAndSwapForExactTokens(
        signer,
        indexPool,
        poolAmountInMax,
        path,
        tokenAmountOut
      );
    }
  },
  /**
   *
   */
  swap: (
    poolAddress: string,
    specifiedSide: "input" | "output",
    inputAmount: string,
    inputTokenSymbol: string,
    outputAmount: string,
    outputTokenSymbol: string,
    maximumPrice: BigNumber
  ): AppThunk => async (_, getState) => {
    if (signer) {
      const state = getState();
      const tokensBySymbol = selectors.selectTokenLookupBySymbol(state);

      let [input, output] = [inputAmount, outputAmount].map(convert.toToken);

      if (specifiedSide === "input") {
        output = downwardSlippage(output, SLIPPAGE_RATE);
      } else {
        input = upwardSlippage(input, SLIPPAGE_RATE);
      }
      const { id: inputAddress } = tokensBySymbol[inputTokenSymbol];
      const { id: outputAddress } = tokensBySymbol[outputTokenSymbol];

      if (inputAddress && outputAddress) {
        const swapper =
          specifiedSide === "input" ? swapExactAmountIn : swapExactAmountOut;

        await swapper(
          signer,
          poolAddress,
          inputAddress,
          outputAddress,
          input,
          output,
          maximumPrice
        );
      } else {
        // --
      }
    }
  },
  independentlyQuery: ({
    caller,
    onChainCalls = [],
    offChainCalls = [],
  }: DataReceiverConfig): AppThunk => async (dispatch, getState) => {
    const state = getState();
    const serializedOnChainCalls = onChainCalls.map(serializeOnChainCall);
    const splitOnChainCalls = serializedOnChainCalls.reduce(
      (prev, next) => {
        const cacheEntry = selectors.selectCacheEntry(state, next);

        if (cacheEntry) {
          prev.cached.calls.push(next);
          prev.cached.results.push(cacheEntry);
        } else {
          prev.notCached.push(next);
        }

        return prev;
      },
      {
        cached: { calls: [], results: [] },
        notCached: [],
      } as {
        cached: {
          calls: string[];
          results: string[][];
        };
        notCached: string[];
      }
    );
    const serializedOffChainCalls = offChainCalls.map(serializeOffChainCall);
    const splitOffChainCalls = serializedOffChainCalls.reduce(
      (prev, next) => {
        const cacheEntry = selectors.selectCacheEntry(state, next);

        if (cacheEntry) {
          prev.cached.calls.push(next);
          prev.cached.results.push(cacheEntry);
        } else {
          prev.notCached.push(next);
        }

        return prev;
      },
      {
        cached: { calls: [], results: [] },
        notCached: [],
      } as {
        cached: {
          calls: string[];
          results: string[][];
        };
        notCached: string[];
      }
    );

    if (splitOnChainCalls.cached.calls.length > 0) {
      const toImmediatelyUpdate = {
        callers: {
          [caller]: {
            onChainCalls: serializedOnChainCalls,
            offChainCalls: serializedOffChainCalls,
          },
        },
        batch: createOnChainBatch(splitOnChainCalls.cached.calls),
      };
      const formattedMulticallData = formatMulticallData(
        toImmediatelyUpdate,
        0,
        splitOnChainCalls.cached.results
      );

      dispatch(actions.cachedMulticallDataReceived(formattedMulticallData));
    }

    if (provider) {
      const toMulticall = createOnChainBatch(splitOnChainCalls.notCached);

      dispatch(
        actions.sendOnChainBatch({
          callers: {
            [caller]: {
              onChainCalls: serializedOnChainCalls,
              offChainCalls: serializedOffChainCalls,
            },
          },
          batch: toMulticall,
        })
      );
    }

    if (splitOffChainCalls.cached.calls.length > 0) {
      let index = 0;
      for (const call of splitOffChainCalls.cached.calls) {
        const [thunkName] = call.split("/");
        const relevantActionCreator = (offChainActionPayloads as any)[
          thunkName
        ];

        if (relevantActionCreator) {
          const relevantResult = splitOffChainCalls.cached.results[index];

          dispatch(relevantActionCreator(relevantResult));
        }

        index++;
      }
    }

    for (const call of splitOffChainCalls.notCached) {
      const action = deserializeOffChainCall(call, thunks as any);

      if (action) {
        dispatch(action());
      }
    }
  },
  sendOnChainBatch: (
    batchConfig: ReturnType<typeof selectors.selectOnChainBatch>
  ): AppThunk => async (dispatch) => {
    if (provider && batchConfig.batch.deserializedCalls.length > 0) {
      dispatch(actions.multicallDataRequested());

      const { blockNumber, results } = await multicall(
        provider,
        batchConfig.batch.deserializedCalls
      );
      const formattedMulticallData = formatMulticallData(
        batchConfig,
        blockNumber,
        results
      );

      dispatch(actions.multicallDataReceived(formattedMulticallData));
    }
  },
  sendOffChainBatch: (
    batch: ReturnType<typeof selectors.selectOffChainBatch>
  ): AppThunk => async (dispatch) => {
    for (const call of batch) {
      const action = deserializeOffChainCall(call, thunks as any);

      if (action) {
        dispatch(action());
      }
    }
  },
};

export const actions = {
  ...batcherActions,
  ...cacheActions,
  ...categoriesActions,
  ...indexPoolsActions,
  ...settingsActions,
  ...stakingActions,
  ...tokensActions,
  ...userActions,
  ...topLevelActions,
  ...thunks,
};

export type ActionType = typeof actions;

export type DataReceiverConfig = {
  caller: string;
  onChainCalls?: RegisteredCall[];
  offChainCalls?: any[];
};

// #region Helpers
export function formatMulticallData(
  batchConfig: ReturnType<typeof selectors.selectOnChainBatch>,
  blockNumber: number,
  results: ethers.utils.Result[]
) {
  const { callers, batch } = batchConfig;
  const callsToResults = batch.registrars.reduce((prev, next) => {
    prev[next] = [];
    return prev;
  }, {} as Record<string, string[]>);

  let previousCutoff = 0;
  for (const registrar of batch.registrars) {
    const callCount = batch.callsByRegistrant[registrar].length;
    const relevantResults = results.slice(
      previousCutoff,
      previousCutoff + callCount
    );

    let index = 0;
    for (const callResult of relevantResults) {
      const call = batch.callsByRegistrant[registrar][index];
      const formattedResults = callResult.map((bn) =>
        bn.toString()
      ) as string[];

      callsToResults[call].push(...formattedResults);

      index++;
    }

    previousCutoff += callCount;
  }

  return {
    blockNumber,
    callers,
    callsToResults,
  };
}
// #endregion
