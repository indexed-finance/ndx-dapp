import { Button } from "components/atoms";
import { Card, Menu, Switch } from "antd";
import { colors } from "theme";
import { createChart } from "lightweight-charts";
import { selectors } from "features";
import { useSelector } from "react-redux";
import React, { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";

export interface Props {
  poolId: string;
  expanded?: boolean;
}

export default function ChartCard({ poolId, expanded = false }: Props) {
  const theme = useSelector(selectors.selectTheme);
  const [kind, setKind] = useState<Kind>("Value");
  const [timeframe, setTimeframe] = useState<Timeframe>("Day");
  const toggleKind = useCallback(
    () =>
      setKind((prevKind) =>
        prevKind === "Value" ? "TotalValueLocked" : "Value"
      ),
    []
  );
  const toggleTimeframe = useCallback(
    () =>
      setTimeframe((prevTimeframe) =>
        prevTimeframe === "Day" ? "Week" : "Day"
      ),
    []
  );
  const cardRef = useRef<null | HTMLDivElement>(null);

  useEffect(() => {
    if (cardRef.current) {
      const size = expanded
        ? { width: 1200, height: 500 }
        : { width: 400, height: 300 };
      const chart = createChart(cardRef.current, size);
      const options = CHART_MODES[theme];
      const lineSeries = chart.addLineSeries();

      chart.applyOptions(options);

      lineSeries.setData([
        { time: "2019-04-11", value: 80.01 },
        { time: "2019-04-12", value: 96.63 },
        { time: "2019-04-13", value: 76.64 },
        { time: "2019-04-14", value: 81.89 },
        { time: "2019-04-15", value: 74.43 },
        { time: "2019-04-16", value: 80.01 },
        { time: "2019-04-17", value: 96.63 },
        { time: "2019-04-18", value: 76.64 },
        { time: "2019-04-19", value: 81.89 },
        { time: "2019-04-20", value: 74.43 },
      ]);
    }
  }, [theme, expanded]);

  return (
    <S.ChartCard
      actions={[
        <div onClick={toggleKind}>
          <S.Switch key="1" checked={kind === "Value"} />
          Value
        </div>,
        <div onClick={toggleKind}>
          <S.Switch key="2" checked={kind === "TotalValueLocked"} />
          Total Value Locked
        </div>,
      ]}
      extra={
        <S.Menu mode="horizontal" selectedKeys={[timeframe]}>
          {["Day", "Week"].map((_timeframe) => (
            <S.MenuItem
              key={_timeframe}
              active={_timeframe === timeframe}
              onClick={toggleTimeframe}
            >
              {_timeframe}
            </S.MenuItem>
          ))}
        </S.Menu>
      }
    >
      <div ref={cardRef} />
    </S.ChartCard>
  );
}

const S = {
  ChartCard: styled(Card)`
    position: relative;
    margin-bottom: ${(props) => props.theme.spacing.medium};

    .ant-card-extra {
      width: 100%;
    }
  `,
  Button: styled(Button)`
    position: absolute;
    right: ${(props) => props.theme.spacing.small};
    bottom: ${(props) => props.theme.spacing.small};
    ${(props) => props.theme.snippets.perfectlyCentered};
  `,
  Menu: styled(Menu)`
    display: flex;
  `,
  MenuItem: styled(Menu.Item)`
    flex: 1;
    text-align: center;
  `,
  Switch: styled(Switch)`
    margin-right: ${(props) => props.theme.spacing.medium};
  `,
};

type Kind = "Value" | "TotalValueLocked";
type Timeframe = "Day" | "Week";

const COMMON_LAYOUT_OPTIONS = {
  fontFamily: "sans-serif",
  fontSize: 16,
};
const CHART_MODES = {
  dark: {
    layout: {
      ...COMMON_LAYOUT_OPTIONS,
      backgroundColor: colors.black400,
      textColor: colors.purple200,
    },
    grid: {
      vertLines: {
        color: colors.purple100,
      },
      horzLines: {
        color: colors.purple100,
      },
    },
  },
  light: {
    layout: {
      ...COMMON_LAYOUT_OPTIONS,
      backgroundColor: colors.white300,
      textColor: colors.black200,
    },
    grid: {
      vertLines: {
        color: colors.purple300,
      },
      horzLines: {
        color: colors.purple300,
      },
    },
  },
};
