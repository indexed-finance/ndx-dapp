import { AppState, selectors } from "features";
import { Card, Menu, Select, Space, Typography } from "antd";
import { SnapshotKey } from "features";
import { useBreakpoints } from "helpers";
import { useCallback, useState } from "react";
import { useSelector } from "react-redux";
import LineSeriesChart from "./LineSeriesChart";
import Quote from "./Quote";

type Timeframe = "Day" | "Week";

export interface Props {
  poolId: string;
  expanded?: boolean;
}

export default function ChartCard({ poolId, expanded = false }: Props) {
  const [key, setKey] = useState<SnapshotKey>("value");
  const [timeframe, setTimeframe] = useState<Timeframe>("Day");
  const data = useSelector((state: AppState) =>
    selectors.selectTimeSeriesSnapshotData(state, poolId, timeframe, key)
  );
  const formattedPool = useSelector((state: AppState) =>
    selectors.selectFormattedIndexPool(state, poolId)
  );
  const toggleTimeframe = useCallback(
    () =>
      setTimeframe((prevTimeframe) =>
        prevTimeframe === "Day" ? "Week" : "Day"
      ),
    []
  );
  const { isMobile } = useBreakpoints();
  const timeframeAction = (
    <>
      <Typography.Paragraph
        type="secondary"
        style={{
          textAlign: "center",
          paddingLeft: isMobile ? 0 : 20,
          marginBottom: isMobile ? -10 : 0,
        }}
      >
        Timeframe
      </Typography.Paragraph>
      <Menu
        style={{ textAlign: "center", marginTop: 0 }}
        mode="horizontal"
        selectedKeys={[timeframe]}
      >
        {["Day", "Week"].map((_timeframe) => (
          <Menu.Item
            key={_timeframe}
            active={_timeframe === timeframe}
            onClick={toggleTimeframe}
          >
            {_timeframe}
          </Menu.Item>
        ))}
      </Menu>
    </>
  );
  const criteriaAction = (
    <>
      <Typography.Paragraph
        type="secondary"
        style={{
          textAlign: "center",
          paddingRight: isMobile ? 0 : 30,
          marginBottom: isMobile ? 0 : 15,
        }}
      >
        Criteria
      </Typography.Paragraph>
      <Select
        value={key}
        style={{ width: isMobile ? "240px" : "80%" }}
        onChange={setKey}
      >
        <Select.Option value="value">Value (in USD)</Select.Option>
        <Select.Option value="totalSupply">Supply (in tokens)</Select.Option>
        <Select.Option value="totalValueLockedUSD">
          Total Value Locked (in USD)
        </Select.Option>
        <Select.Option value="totalSwapVolumeUSD">
          Total Swap Volume (in USD)
        </Select.Option>
        <Select.Option value="feesTotalUSD">
          Total Swap Fees (in USD)
        </Select.Option>
      </Select>
    </>
  );
  const actions = isMobile
    ? [
        <Space direction="vertical" key="1">
          {timeframeAction}
          {criteriaAction}
        </Space>,
      ]
    : [
        <div key="1">{timeframeAction}</div>,
        <div key="2">{criteriaAction}</div>,
      ];

  return (
    <Card
      title={
        formattedPool && (
          <Quote
            symbol={formattedPool.symbol}
            price={formattedPool.priceUsd}
            netChange={formattedPool.netChange}
            netChangePercent={formattedPool.netChangePercent}
            isNegative={formattedPool.isNegative}
            inline={!isMobile}
          />
        )
      }
      bodyStyle={{ padding: 0, height: 300 }}
      actions={actions}
    >
      <LineSeriesChart data={data} expanded={expanded} />
    </Card>
  );
}
