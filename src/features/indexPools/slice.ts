import { DEFAULT_DECIMAL_COUNT } from "config";
import { NormalizedPool, PoolTokenUpdate } from "ethereum";
import { PoolUnderlyingToken } from "indexed-types";
import { categoriesSelectors } from "../categories";
import { convert } from "helpers";
import { createEntityAdapter, createSlice } from "@reduxjs/toolkit";
import {
  poolTradesAndSwapsLoaded,
  poolUpdated,
  receivedInitialStateFromServer,
  receivedStatePatchFromServer,
  subgraphDataLoaded,
} from "features/actions";
import { tokensSelectors } from "features/tokens";
import S from "string";
import type { AppState } from "features/store";

const adapter = createEntityAdapter<NormalizedPool>();

const slice = createSlice({
  name: "indexPools",
  initialState: adapter.getInitialState(),
  reducers: {},
  extraReducers: (builder) =>
    builder
      .addCase(subgraphDataLoaded, (state, action) => {
        const { pools } = action.payload;
        const fullPools = pools.ids.map((id) => pools.entities[id]);

        for (const { tokens } of fullPools) {
          for (const tokenId of tokens.ids) {
            const token = tokens.entities[tokenId];

            if (token.ready) {
              token.usedDenorm = token.denorm;
              token.usedBalance = token.balance;
            } else {
              token.usedDenorm = token.desiredDenorm;
              token.usedBalance = token.minimumBalance;
            }
          }
        }

        adapter.addMany(state, fullPools);
      })
      .addCase(poolUpdated, (state, action) => {
        const { pool, update } = action.payload;

        const poolInState = state.entities[pool.id];

        if (poolInState) {
          const { $blockNumber: _, tokens, ...rest } = update;
          const tokenEntities: Record<
            string,
            PoolTokenUpdate & PoolUnderlyingToken
          > = {};

          for (const token of tokens) {
            const { address, ...tokenUpdate } = token;
            const tokenInState = pool.tokens.entities[address];

            tokenEntities[address] = {
              ...tokenInState,
              ...tokenUpdate,
            };
          }

          state.entities[pool.id] = {
            ...poolInState,
            ...rest,
            tokens: {
              ids: poolInState.tokens.ids,
              entities: tokenEntities,
            },
          };
        }
      })
      .addCase(poolTradesAndSwapsLoaded, (state, action) => {
        const { poolId, trades, swaps } = action.payload;
        const poolInState = state.entities[poolId];

        if (poolInState) {
          poolInState.trades = trades ?? poolInState.trades;
          poolInState.swaps = swaps ?? poolInState.swaps;
        }
      })
      .addCase(receivedInitialStateFromServer, (_, action) => {
        const { indexPools } = action.payload;
        return indexPools;
      })
      .addCase(receivedStatePatchFromServer, (_, action) => {
        const { indexPools } = action.payload;

        return indexPools;
      }),
});

export const { actions } = slice;

export const selectors = {
  ...adapter.getSelectors((state: AppState) => state.indexPools),
  selectPool: (state: AppState, poolId: string) => selectors.selectById(state, poolId),
  selectNameForPool: (state: AppState, poolId: string) => {
    const pool = selectors.selectPool(state, poolId);
    return pool ? formatName(pool.name) : "";
  },
  selectPoolLookUpByName: (state: AppState) => {
    const formatName = (from: string) => S(from).camelize().s.toLowerCase();
    return selectors.selectAllPools(state).reduce((prev, next) => {
      prev[formatName(next.name)] = next;
      return prev;
    }, {} as Record<string, NormalizedPool>);
  },
  /**
   * @returns undefined if no pools are loaded yet;
   * pool ID if a pool is found for the provided name;
   * empty string if no pool is found for the provided name
   */
  selectPoolIdByName: (state: AppState, name: string) => {
    const poolsByName = selectors.selectPoolLookUpByName(state);
    if (Object.keys(poolsByName).length === 0) {
      return undefined;
    }
    const formattedName = formatName(name);
    const pool = poolsByName[formattedName];
    if (pool) {
      return pool.id;
    }
    return "";
  },
  selectPoolByName: (state: AppState, name: string) => {
    const poolsByName = selectors.selectPoolLookUpByName(state);
    const formattedName = formatName(name);

    return poolsByName[formattedName] ?? null;
  },
  selectAllPools: (state: AppState) => selectors.selectAll(state),
  selectPoolLookup: (state: AppState) => selectors.selectEntities(state),
  selectPoolTokenIds: (state: AppState, poolId: string) => {
    const pool = selectors.selectPool(state, poolId);
    return pool?.tokens.ids ?? [];
  },
  selectPoolTokenAddresses: (state: AppState, poolId: string) => {
    const pool = selectors.selectPool(state, poolId);
    return pool?.tokens.ids.map((t) => pool.tokens.entities[t].token.id) ?? [];
  },
  selectPoolTokenSymbols: (state: AppState, poolId: string) => {
    const tokenIds = selectors.selectPoolTokenIds(state, poolId);
    const tokenLookup = tokensSelectors.selectEntities(state);
    const symbols = tokenIds.map((id) => tokenLookup[id]?.symbol ?? "");

    return symbols;
  },
  selectSwapFee: (state: AppState, poolId: string) => {
    const pool = selectors.selectPool(state, poolId);
    return pool ? convert.toBigNumber(pool.swapFee) : null;
  },
  selectPoolInitializerAddress: (state: AppState, poolId: string) => {
    const pool = selectors.selectPool(state, poolId);
    return pool?.poolInitializer?.id ?? null;
  },
  selectCategoryImage: (state: AppState, poolId: string) => {
    const pool = selectors.selectPool(state, poolId);

    if (pool) {
      const { id } = pool.category;
      const categoryLookup = categoriesSelectors.selectEntities(state);
      const category = categoryLookup[id];

      return category?.symbol ?? "";
    } else {
      return "";
    }
  },
  selectCategoryImagesByPoolIds: (state: AppState) =>
    selectors
      .selectAllPools(state)
      .map((pool) => ({
        id: pool.id,
        image: selectors.selectCategoryImage(state, pool.id),
      }))
      .reduce((prev, next) => {
        prev[next.id] = next.image;
        return prev;
      }, {} as Record<string, string>),
  selectPoolUnderlyingTokens: (state: AppState, poolId: string) => {
    return Object.values(
      state.indexPools.entities[poolId]?.tokens.entities ?? {}
    );
  },
  selectTokenWeights: (state: AppState, poolId: string, tokenIds: string[]) => {
    const pool = selectors.selectPool(state, poolId);
    const weights = tokenIds.reduce((prev, next) => {
      prev[next] = "-";
      return prev;
    }, {} as Record<string, string>);

    try {
      if (pool) {
        for (const tokenId of tokenIds) {
          const denorm = convert.toBigNumber(
            pool.tokens.entities[tokenId].denorm
          );
          const totalWeight = convert.toBigNumber(pool.totalWeight);
          const prescaled = denorm.dividedBy(totalWeight);
          const scalePower = convert.toBigNumber(
            DEFAULT_DECIMAL_COUNT.toString()
          );
          const scaleMultiplier = convert.toBigNumber("10").pow(scalePower);
          const weight = prescaled.multipliedBy(scaleMultiplier);

          weights[tokenId] = weight.toString();
        }
      }
    } catch {}

    return weights;
  },
};

export default slice.reducer;

// #region Helpers
function formatName(from: string) {
  return S(from).camelize().s.toLowerCase();
}
// #endregion
