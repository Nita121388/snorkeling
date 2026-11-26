// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// W2-1（性能）：从 sysinfo.tsx 拆出的视图层。@observablehq/plot 与 htl 只被视图
// 使用，留在 model 文件里会把它们灌进每个终端 Tab 的入口 chunk（builtinviews
// 静态引用 SysinfoViewModel）。加载入口：sysinfo.tsx 的 viewComponent 走
// React.lazy(() => import("./sysinfo-view"))，块挂载处的 Suspense 提供加载态。

import { globalStore } from "@/app/store/jotaiStore";
import { useDimensionsWithExistingRef } from "@/app/hook/useDimensions";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { convertWaveEventToDataItem, type DataItem, type SysinfoViewModel } from "@/app/view/sysinfo/sysinfo";
import * as Plot from "@observablehq/plot";
import clsx from "clsx";
import dayjs from "dayjs";
import * as htl from "htl";
import * as jotai from "jotai";
import * as React from "react";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";

const _plotColors = ["#58C142", "#FFC107", "#FF5722", "#2196F3", "#9C27B0", "#00BCD4", "#FFEB3B", "#795548"];

export type SysinfoViewProps = {
    blockId: string;
    model: SysinfoViewModel;
};

function resolveDomainBound(value: number | string, dataItem: DataItem): number | undefined {
    if (typeof value == "number") {
        return value;
    } else if (typeof value == "string") {
        return dataItem?.[value];
    } else {
        return undefined;
    }
}

export function SysinfoView({ model, blockId }: SysinfoViewProps) {
    const connName = jotai.useAtomValue(model.connection);
    const lastConnName = React.useRef(connName);
    const connStatus = jotai.useAtomValue(model.connStatus);
    const addContinuousData = jotai.useSetAtom(model.addContinuousDataAtom);
    const loading = jotai.useAtomValue(model.loadingAtom);

    React.useEffect(() => {
        if (connStatus?.status != "connected") {
            return;
        }
        if (lastConnName.current !== connName) {
            lastConnName.current = connName;
            model.loadInitialData();
        }
    }, [connStatus.status, connName]);
    React.useEffect(() => {
        const unsubFn = waveEventSubscribeSingle({
            eventType: "sysinfo",
            scope: connName,
            handler: (event) => {
                const loading = globalStore.get(model.loadingAtom);
                if (loading) {
                    return;
                }
                const dataItem = convertWaveEventToDataItem(event);
                const prevData = globalStore.get(model.dataAtom);
                const prevLastTs = prevData[prevData.length - 1]?.ts ?? 0;
                if (dataItem.ts - prevLastTs > 2000) {
                    model.loadInitialData();
                } else {
                    addContinuousData(dataItem);
                }
            },
        });
        console.log("subscribe to sysinfo", connName);
        return () => {
            unsubFn();
        };
    }, [connName, addContinuousData]);
    if (connStatus?.status != "connected") {
        return null;
    }
    if (loading) {
        return null;
    }
    return <SysinfoViewInner key={connStatus?.connection ?? "local"} blockId={blockId} model={model} />;
}

type SingleLinePlotProps = {
    plotData: Array<DataItem>;
    yval: string;
    yvalMeta: TimeSeriesMeta;
    blockId: string;
    defaultColor: string;
    title?: boolean;
    sparkline?: boolean;
    targetLen: number;
};

function SingleLinePlot({
    plotData,
    yval,
    yvalMeta,
    blockId,
    defaultColor,
    title = false,
    sparkline = false,
    targetLen,
}: SingleLinePlotProps) {
    const containerRef = React.useRef<HTMLInputElement>(null);
    const domRect = useDimensionsWithExistingRef(containerRef, 300);
    const plotHeight = domRect?.height ?? 0;
    const plotWidth = domRect?.width ?? 0;
    const marks: Plot.Markish[] = [];
    const decimalPlaces = yvalMeta?.decimalPlaces ?? 0;
    let color = yvalMeta?.color;
    if (!color) {
        color = defaultColor;
    }
    marks.push(
        () => htl.svg`<defs>
      <linearGradient id="gradient-${blockId}-${yval}" gradientTransform="rotate(90)">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.7" />
        <stop offset="100%" stop-color="${color}" stop-opacity="0" />
      </linearGradient>
	      </defs>`
    );

    marks.push(
        Plot.lineY(plotData, {
            stroke: color,
            strokeWidth: 2,
            x: "ts",
            y: yval,
        })
    );

    // only add the gradient for single items
    marks.push(
        Plot.areaY(plotData, {
            fill: `url(#gradient-${blockId}-${yval})`,
            x: "ts",
            y: yval,
        })
    );
    if (title) {
        marks.push(
            Plot.text([yvalMeta?.name], {
                frameAnchor: "top-left",
                dx: 4,
                fill: "var(--grey-text-color)",
            })
        );
    }
    const labelY = yvalMeta?.label ?? "?";
    marks.push(
        Plot.ruleX(
            plotData,
            Plot.pointerX({ x: "ts", py: yval, stroke: "var(--grey-text-color)", strokeWidth: 1, strokeDasharray: 2 })
        )
    );
    marks.push(
        Plot.ruleY(
            plotData,
            Plot.pointerX({ px: "ts", y: yval, stroke: "var(--grey-text-color)", strokeWidth: 1, strokeDasharray: 2 })
        )
    );
    marks.push(
        Plot.tip(
            plotData,
            Plot.pointerX({
                x: "ts",
                y: yval,
                fill: "var(--main-bg-color)",
                anchor: "middle",
                dy: -30,
                title: (d) =>
                    `${dayjs.unix(d.ts / 1000).format("HH:mm:ss")} ${Number(d[yval]).toFixed(decimalPlaces)}${labelY}`,
                textPadding: 3,
            })
        )
    );
    marks.push(
        Plot.dot(
            plotData,
            Plot.pointerX({ x: "ts", y: yval, fill: color, r: 3, stroke: "var(--main-text-color)", strokeWidth: 1 })
        )
    );
    const maxY = resolveDomainBound(yvalMeta?.maxy, plotData[plotData.length - 1]) ?? 100;
    const minY = resolveDomainBound(yvalMeta?.miny, plotData[plotData.length - 1]) ?? 0;
    const maxX = plotData[plotData.length - 1].ts;
    const minX = maxX - targetLen * 1000;
    const plot = Plot.plot({
        axis: !sparkline,
        x: {
            grid: true,
            label: "time",
            tickFormat: (d) => `${dayjs.unix(d / 1000).format("HH:mm:ss")}`,
            domain: [minX, maxX],
        },
        y: { label: labelY, domain: [minY, maxY] },
        width: plotWidth,
        height: plotHeight,
        marks: marks,
    });

    React.useEffect(() => {
        containerRef.current.append(plot);

        return () => {
            plot.remove();
        };
    }, [plot, plotWidth, plotHeight]);

    return <div ref={containerRef} className="min-h-[100px]" />;
}

const SysinfoViewInner = React.memo(({ model }: SysinfoViewProps) => {
    const plotData = jotai.useAtomValue(model.dataAtom);
    const yvals = jotai.useAtomValue(model.metrics);
    const plotMeta = jotai.useAtomValue(model.plotMetaAtom);
    const osRef = React.useRef<OverlayScrollbarsComponentRef>(null);
    const targetLen = jotai.useAtomValue(model.numPoints) + 1;
    let title = false;
    let cols2 = false;
    if (yvals.length > 1) {
        title = true;
    }
    if (yvals.length > 2) {
        cols2 = true;
    }

    return (
        <OverlayScrollbarsComponent
            ref={osRef}
            className="flex flex-col flex-grow mb-0 overflow-y-auto"
            options={{ scrollbars: { autoHide: "leave" } }}
        >
            <div
                className={clsx("w-full h-full grid grid-rows-[repeat(auto-fit,minmax(100px,1fr))] gap-[10px]", {
                    "grid-cols-2": cols2,
                })}
            >
                {plotData &&
                    plotData.length > 0 &&
                    yvals.map((yval, _idx) => {
                        return (
                            <SingleLinePlot
                                key={`plot-${model.blockId}-${yval}`}
                                plotData={plotData}
                                yval={yval}
                                yvalMeta={plotMeta.get(yval)}
                                blockId={model.blockId}
                                defaultColor={"var(--accent-color)"}
                                title={title}
                                targetLen={targetLen}
                            />
                        );
                    })}
            </div>
        </OverlayScrollbarsComponent>
    );
});
