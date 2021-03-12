import { Action, Performance, Recent, Subscreen } from "../subscreens";
import { AppState, actions, selectors } from "features";
import { CgArrowsExpandRight } from "react-icons/cg";
import {
  ChartCard,
  PoolDropdown,
  PoolInteractions,
  ProviderRequirementDrawer,
  RankedToken,
  ScreenHeader,
} from "components";
import { Col, Row, Space } from "antd";
import { Link, Redirect, useParams } from "react-router-dom";
import { useBreakpoints } from "helpers";
import { useDispatch, useSelector } from "react-redux";
import { useEffect, useMemo } from "react";

export default function PoolDetail() {
  const dispatch = useDispatch();
  const { poolName } = useParams<{ poolName: string }>();
  const pool = useSelector((state: AppState) =>
    selectors.selectFormattedIndexPool(state, poolName)
  );
  const id = useMemo(() => pool?.id ?? "", [pool]);
  const isConnected = useSelector(selectors.selectConnected);
  const breakpoints = useBreakpoints();
  const chartActions = useMemo(
    () =>
      [
        {
          type: "default",
          title: (
            <Link to={`/pools/${poolName}/chart`}>
              Expand <CgArrowsExpandRight />
            </Link>
          ),
          onClick: () => {
            /* */
          },
        },
      ] as Action[],
    [poolName]
  );
  const interactionActions = useMemo(
    () =>
      [
        {
          title: "Swap",
          onClick: () => {
            /* */
          },
          type: "primary",
        },
      ] as Action[],
    []
  );

  // Effect:
  // When the pool changes and not connected to the server, get the juicy details.
  useEffect(() => {
    let poolUpdateListenerId: string;

    // This screen always needs user data.
    const tokenUserDataListenerId = (dispatch(
      actions.tokenUserDataListenerRegistered(id)
    ) as unknown) as string;

    // Pool updates and TheGraph/CoinGecko data is only required if not receiving data from the server.
    if (!isConnected) {
      poolUpdateListenerId = (dispatch(
        actions.poolUpdateListenerRegistered(id)
      ) as unknown) as string;
    }

    // After adding the listeners, trigger a batch send so the user can see data fast.
    dispatch(actions.sendBatch());

    return () => {
      [tokenUserDataListenerId, poolUpdateListenerId]
        .filter(Boolean)
        .forEach((_id) => dispatch(actions.listenerUnregistered(_id)));
    };
  }, [dispatch, id, isConnected]);

  if (pool) {
    // Subscreens
    const performance = <Performance pool={pool} />;
    const chart = (
      <Subscreen title="Chart" padding={0} defaultActions={chartActions}>
        {id ? <ChartCard poolId={id} /> : null}
      </Subscreen>
    );
    const assets = (
      <Subscreen title="Assets" padding={0}>
        <Space wrap={true} align="start">
          {pool.assets.map((token, index) => (
            <RankedToken key={token.symbol} rank={index + 1} token={token} />
          ))}
        </Space>
        {/* */}
      </Subscreen>
    );
    const interactions = (
      <Subscreen
        title="Interact"
        padding={0}
        defaultActions={interactionActions}
      >
        <ProviderRequirementDrawer includeSignerRequirement={true} />
        <PoolInteractions pool={pool} />
      </Subscreen>
    );
    const recents = <Recent pool={pool} />;

    // Variants
    const mobileSized = (
      <Row gutter={25}>
        <Col span={24}>{performance}</Col>
        <Col span={24}>{chart}</Col>
        <Col span={24}>{interactions}</Col>
        <Col span={24}>{assets}</Col>
        <Col span={24}>{recents}</Col>
      </Row>
    );
    const tabletSized = (
      <>
        <Row gutter={25}>
          <Col span={12}>
            {performance}
            {chart}
          </Col>
          <Col span={12}>
            {assets}
            {interactions}
          </Col>
        </Row>
        <Row gutter={25}>
          <Col span={24}>{recents}</Col>
        </Row>
      </>
    );
    const desktopSized = (
      <Row gutter={20}>
        <Col span={16}>
          <Row gutter={25}>
            <Col span={12}>
              {performance}
              {chart}
            </Col>
            <Col span={12}>{interactions}</Col>
          </Row>
          <Row gutter={25}>
            <Col span={24}>{recents}</Col>
          </Row>
        </Col>
        <Col span={8}>{assets}</Col>
      </Row>
    );

    return (
      <>
        <ScreenHeader
          title={pool.name}
          overlay={<PoolDropdown />}
          activeBreadcrumb={<Link to="/pools">Index Pools</Link>}
        />
        {(() => {
          switch (true) {
            case breakpoints.xxl:
              return desktopSized;
            case breakpoints.xl:
              return tabletSized;
            case breakpoints.lg:
              return tabletSized;
            case breakpoints.md:
              return tabletSized;
            case breakpoints.sm:
              return tabletSized;
            case breakpoints.xs:
              return mobileSized;
          }
        })()}
      </>
    );
  } else {
    return <Redirect to="/pools" />;
  }
}
