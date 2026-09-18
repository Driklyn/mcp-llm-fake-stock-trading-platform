import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  ChartShell,
  Eyebrow,
  Stat,
  StatsGrid,
  colors,
  fontSizes,
  fontWeights,
  fonts,
  radii,
  sprinkles,
} from "ui";
import {
  buildChartGeometry,
  buildChartSeries,
  type MappedChartPoint,
} from "../utils/chart";
import type { ChartInputPoint } from "../types";

const chartFontStack = fonts.body;

export type MarketChartProps = {
  points: ChartInputPoint[];
  price: number | null;
  refreshSeconds: number;
};

export default function MarketChart({
  points,
  price,
  refreshSeconds,
}: MarketChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverIndex, setHoverIndex] = useState(-1);
  const [chartSize, setChartSize] = useState({ width: 320, height: 320 });

  const chartSeries = useMemo(() => buildChartSeries(points), [points]);

  const chartWidth = chartSize.width;
  const chartHeight = chartSize.height;
  const chartGeometry = useMemo(
    () => buildChartGeometry(chartSeries, chartWidth, chartHeight),
    [chartSeries, chartWidth, chartHeight],
  );

  const isHovering = hoverIndex >= 0 && chartGeometry.points.length > 0;
  const activePoint: MappedChartPoint | null = isHovering
    ? chartGeometry.points[
        Math.min(Math.max(hoverIndex, 0), chartGeometry.points.length - 1)
      ]
    : null;
  const tooltipText = `${activePoint?.timeLabel ?? ""} • $${Number(activePoint?.value ?? 0).toFixed(2)}`;

  const handleChartMouseMove = (event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = ((event.clientX - rect.left) / rect.width) * chartWidth;
    const nearestPoint = chartGeometry.points.reduce((closest, point) => {
      const currentDistance = Math.abs(point.x - relativeX);
      const closestDistance = Math.abs(closest.x - relativeX);
      return currentDistance < closestDistance ? point : closest;
    }, chartGeometry.points[0]);

    setHoverIndex(nearestPoint.index);
  };

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const shell = canvas?.parentElement ?? null;
    if (!shell || !canvas) return;

    const resizeCanvas = () => {
      const width = Math.max(1, Math.round(shell.clientWidth));
      const height = Math.max(1, Math.round(shell.clientHeight));
      const dpr = window.devicePixelRatio || 1;

      setChartSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );

      if (
        canvas.width !== Math.round(width * dpr) ||
        canvas.height !== Math.round(height * dpr)
      ) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }

      canvas.style.width = "100%";
      canvas.style.height = "100%";
    };

    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 500;
    const cssHeight = canvas.clientHeight || 420;

    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    ctx.fillStyle = colors.surfaceChart;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    ctx.fillStyle = colors.textMuted;
    ctx.font = `${fontWeights.semibold} ${fontSizes.sm}px ${chartFontStack}`;

    chartGeometry.yTicks.forEach((tick) => {
      ctx.beginPath();
      ctx.moveTo(chartGeometry.padding.left, tick.y);
      ctx.lineTo(chartWidth - chartGeometry.padding.right, tick.y);
      ctx.strokeStyle = colors.gridLine;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(
        `$${Number(tick.value).toFixed(2)}`,
        chartGeometry.padding.left + 12,
        tick.y,
      );
    });

    chartGeometry.xTicks.forEach((tick) => {
      ctx.beginPath();
      ctx.moveTo(tick.x, chartGeometry.padding.top);
      ctx.lineTo(tick.x, chartHeight - chartGeometry.padding.bottom);
      ctx.strokeStyle = colors.gridLine;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.textAlign = tick.align;
      ctx.textBaseline = "top";
      ctx.fillText(tick.label, tick.labelX ?? tick.x, chartHeight - 18);
    });

    ctx.beginPath();
    chartGeometry.points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    if (activePoint) {
      ctx.beginPath();
      ctx.moveTo(activePoint.x, chartGeometry.padding.top);
      ctx.lineTo(activePoint.x, chartHeight - chartGeometry.padding.bottom);
      ctx.strokeStyle = colors.textOnPrimary;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.fillStyle = colors.textOnPrimary;
      ctx.arc(activePoint.x, activePoint.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 2;
      ctx.stroke();

      const bubbleWidth = 138;
      const bubbleHeight = 30;
      const inset = 18;
      const textPaddingX = 10;
      const bubbleX = Math.min(
        Math.max(activePoint.x + 12, inset + bubbleWidth / 2),
        cssWidth - bubbleWidth / 2 - inset,
      );
      const bubbleY = Math.min(
        Math.max(activePoint.y - 30, inset + bubbleHeight / 2),
        cssHeight - bubbleHeight / 2 - inset,
      );

      ctx.beginPath();
      ctx.fillStyle = colors.surfaceOverlay;
      ctx.roundRect(
        bubbleX - bubbleWidth / 2,
        bubbleY - bubbleHeight / 2,
        bubbleWidth,
        bubbleHeight,
        radii.sm,
      );
      ctx.fill();

      ctx.fillStyle = colors.textStrong;
      ctx.font = `${fontWeights.bold} ${fontSizes.sm}px ${chartFontStack}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(tooltipText, bubbleX, bubbleY);

      const textBounds = ctx.measureText(tooltipText);
      const leftTextBound = bubbleX - textBounds.width / 2;
      const rightTextBound = bubbleX + textBounds.width / 2;
      const safeMinX = bubbleX - bubbleWidth / 2 + textPaddingX;
      const safeMaxX = bubbleX + bubbleWidth / 2 - textPaddingX;

      if (leftTextBound < safeMinX || rightTextBound > safeMaxX) {
        const overshoot = Math.max(
          safeMinX - leftTextBound,
          rightTextBound - safeMaxX,
        );
        const adjustedWidth = bubbleWidth + overshoot * 2;
        ctx.fillStyle = colors.surfaceOverlay;
        ctx.beginPath();
        ctx.roundRect(
          bubbleX - adjustedWidth / 2,
          bubbleY - bubbleHeight / 2,
          adjustedWidth,
          bubbleHeight,
          radii.sm,
        );
        ctx.fill();
        ctx.fillStyle = colors.textStrong;
        ctx.fillText(tooltipText, bubbleX, bubbleY);
      }
    }
  }, [chartGeometry, activePoint, chartWidth, chartHeight, tooltipText]);

  return (
    <>
      <StatsGrid>
        <div
          className={sprinkles({
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          })}
        >
          <Eyebrow>Ticker Symbol:</Eyebrow>
          <h2 className={sprinkles({ margin: "none" })}>FAKE</h2>
        </div>
        <div></div>
        <div></div>
        <div></div>
        <Stat
          label="Current price"
          value={price != null ? `$${price.toFixed(2)}` : "Loading…"}
        >
          <div
            className={sprinkles({
              marginTop: "xs",
              fontSize: "xs",
            })}
          >
            Refreshing in {refreshSeconds}s
          </div>
        </Stat>
      </StatsGrid>

      <ChartShell>
        <canvas
          ref={canvasRef}
          className="chart"
          onMouseMove={handleChartMouseMove}
          onMouseLeave={() => setHoverIndex(-1)}
        />
      </ChartShell>
    </>
  );
}
