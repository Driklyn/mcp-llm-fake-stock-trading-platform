import type { ChartInputPoint } from "../types";

export type RawChartPoint = {
  value?: number;
  price?: number;
  timestamp?: number;
  time?: number;
};

export type ChartPoint = {
  value: number;
  timestamp: number;
  timeLabel: string;
};

export type MappedChartPoint = ChartPoint & {
  index: number;
  x: number;
  y: number;
};

export type ChartTick = {
  value: number;
  y: number;
};

export type ChartXTick = {
  index: number;
  x: number;
  labelX: number;
  align: "left" | "right" | "center";
  label: string;
};

export type ChartGeometry = {
  minValue: number;
  maxValue: number;
  linePath: string;
  points: MappedChartPoint[];
  yTicks: ChartTick[];
  xTicks: ChartXTick[];
  usableWidth: number;
  usableHeight: number;
  padding: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
};

export function formatChartTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function buildChartSeries(history: ChartInputPoint[]): ChartPoint[] {
  const rawEntries = Array.isArray(history) ? history : [];

  return rawEntries.map((entry) => {
    const value = Number(
      (entry as RawChartPoint)?.value ?? (entry as RawChartPoint)?.price ?? 0,
    );
    const timestamp = Number(
      (entry as RawChartPoint)?.timestamp ??
        (entry as RawChartPoint)?.time ??
        0,
    );

    return {
      value: Number.isFinite(value) ? value : 0,
      timestamp,
      timeLabel: formatChartTime(new Date(timestamp)),
    };
  });
}

export function buildChartGeometry(
  points: ChartPoint[],
  width: number,
  height: number,
  padding = { top: 16, right: 16, bottom: 28, left: 40 },
): ChartGeometry {
  const safePoints =
    Array.isArray(points) && points.length > 0
      ? points
      : [
          {
            value: 0,
            timestamp: Date.now(),
            timeLabel: formatChartTime(new Date()),
          },
        ];
  const values = safePoints.map((point) => Number(point.value));
  const rawMinValue = Math.min(...values);
  const rawMaxValue = Math.max(...values);
  const axisPadding = Math.max(
    5,
    (rawMaxValue - rawMinValue || rawMaxValue || 1) * 0.12,
  );
  const minValue = Math.max(0, rawMinValue - axisPadding);
  const maxValue = rawMaxValue + axisPadding;
  const domain = maxValue - minValue || 1;
  const yLabelWidth = 48;
  const leftPadding = Math.max(padding.left, yLabelWidth + 16);
  const usableWidth = width - leftPadding - padding.right;
  const usableHeight = height - padding.top - padding.bottom;

  const plotLeft = leftPadding;

  const timestamps = safePoints.map((point) => Number(point.timestamp) || 0);
  const hasTimestampData =
    timestamps.length > 0 && timestamps.every((timestamp) => timestamp > 0);
  const minTimestamp = hasTimestampData ? Math.min(...timestamps) : 0;
  const maxTimestamp = hasTimestampData ? Math.max(...timestamps) : 0;
  const timeRange = Math.max(maxTimestamp - minTimestamp, 1);

  const mappedPoints = safePoints.map((point, index) => {
    const ratio = hasTimestampData
      ? (Number(point.timestamp) - minTimestamp) / timeRange
      : index / Math.max(safePoints.length - 1, 1);
    const x = plotLeft + Math.min(Math.max(ratio, 0), 1) * usableWidth;
    const y =
      height -
      padding.bottom -
      ((Number(point.value) - minValue) / domain) * usableHeight;

    return {
      index,
      value: Number(point.value),
      timestamp: Number(point.timestamp) || 0,
      timeLabel: point.timeLabel,
      x,
      y,
    };
  });

  const linePath = mappedPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  const yTicks = Array.from({ length: 5 }, (_, tickIndex) => {
    const ratio = tickIndex / 4;
    const value = maxValue - domain * ratio;
    const y = padding.top + ratio * usableHeight;
    return { value, y };
  }).reverse();

  const rawXTicks: ChartXTick[] = Array.from({ length: 4 }, (_, tickIndex) => {
    const ratio = tickIndex / 3;
    const index = Math.round(ratio * (safePoints.length - 1));
    const x = plotLeft + ratio * usableWidth;
    const nearestPoint =
      mappedPoints.reduce(
        (closest, point) =>
          Math.abs(point.x - x) < Math.abs(closest.x - x) ? point : closest,
        mappedPoints[0],
      ) ?? mappedPoints[mappedPoints.length - 1];
    const labelX =
      tickIndex === 0 ? plotLeft + 10 : tickIndex === 3 ? width - 16 : x;
    const align: ChartXTick["align"] =
      tickIndex === 0 ? "left" : tickIndex === 3 ? "right" : "center";

    return {
      index,
      x,
      labelX,
      align,
      label: nearestPoint?.timeLabel ?? "",
    };
  });

  // Avoid rendering the same time label twice when data is sparse.
  const xTicks = rawXTicks.map((tick, tickIndex) => ({
    ...tick,
    label:
      tickIndex > 0 && tick.label === rawXTicks[tickIndex - 1].label
        ? ""
        : tick.label,
  }));

  return {
    minValue,
    maxValue,
    linePath,
    points: mappedPoints,
    yTicks,
    xTicks,
    usableWidth,
    usableHeight,
    padding,
  };
}
