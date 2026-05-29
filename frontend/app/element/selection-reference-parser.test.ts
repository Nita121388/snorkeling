// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { parseFileReference } from "./selection-reference-parser";

describe("selection reference parser", () => {
    it("parses hash line references", () => {
        expect(parseFileReference("ReagentGridView.cs#L794")).toEqual({
            rawText: "ReagentGridView.cs#L794",
            filePath: "ReagentGridView.cs",
            lineNumber: 794,
            columnNumber: undefined,
            endLineNumber: undefined,
        });
    });

    it("parses colon references with columns", () => {
        expect(parseFileReference("src/views/ReagentGridView.cs:48:7")).toEqual({
            rawText: "src/views/ReagentGridView.cs:48:7",
            filePath: "src/views/ReagentGridView.cs",
            lineNumber: 48,
            columnNumber: 7,
            endLineNumber: undefined,
        });
    });

    it("parses colon references with trailing text hints", () => {
        expect(parseFileReference("code/scripts/s26_freeze_input_snapshot.py:84：normalize_date_series()")).toEqual({
            rawText: "code/scripts/s26_freeze_input_snapshot.py:84:normalize_date_series()",
            filePath: "code/scripts/s26_freeze_input_snapshot.py",
            lineNumber: 84,
            columnNumber: undefined,
            textHint: "normalize_date_series()",
        });
    });

    it("parses Visual Studio style references", () => {
        expect(parseFileReference("C:\\repo\\src\\ReagentGridView.cs(128,9)")).toEqual({
            rawText: "C:\\repo\\src\\ReagentGridView.cs(128,9)",
            filePath: "C:/repo/src/ReagentGridView.cs",
            lineNumber: 128,
            columnNumber: 9,
        });
    });

    it("parses Python traceback references", () => {
        expect(parseFileReference('File "src/app/main.py", line 42, in run')).toEqual({
            rawText: 'File "src/app/main.py", line 42',
            filePath: "src/app/main.py",
            lineNumber: 42,
        });
    });

    it("parses markdown GitHub references", () => {
        expect(
            parseFileReference("[open](https://github.com/org/repo/blob/main/src/views/ReagentGridView.cs#L48-L50)")
        ).toEqual({
            rawText: "https://github.com/org/repo/blob/main/src/views/ReagentGridView.cs#L48-L50",
            filePath: "src/views/ReagentGridView.cs",
            lineNumber: 48,
            columnNumber: undefined,
            endLineNumber: 50,
        });
    });

    it("parses fallback references from file plus line data", () => {
        expect(parseFileReference("定位结果: 文件=TestResult.cs, line=213, col=9")).toEqual({
            rawText: "定位结果: 文件=TestResult.cs, line=213, col=9",
            filePath: "TestResult.cs",
            lineNumber: 213,
            columnNumber: 9,
            endLineNumber: undefined,
        });
    });

    it("parses path-only references", () => {
        expect(parseFileReference("src/components/Button.tsx")).toEqual({
            rawText: "src/components/Button.tsx",
            filePath: "src/components/Button.tsx",
            lineNumber: undefined,
            columnNumber: undefined,
            endLineNumber: undefined,
        });
    });

    it("parses indented multiline absolute directory references", () => {
        expect(
            parseFileReference(
                "/Users/nita/Primary/projects/ad-model-training-archive/\n" +
                    "  stages/S27_full64_tpot_targeted_ceiling_trace/\n" +
                    "  README.md:388"
            )
        ).toEqual({
            rawText:
                "/Users/nita/Primary/projects/ad-model-training-archive/stages/S27_full64_tpot_targeted_ceiling_trace/README.md:388",
            filePath:
                "/Users/nita/Primary/projects/ad-model-training-archive/stages/S27_full64_tpot_targeted_ceiling_trace/README.md",
            lineNumber: 388,
            columnNumber: undefined,
            endLineNumber: undefined,
        });
    });

    it("parses soft-wrapped multiline absolute path segments", () => {
        expect(
            parseFileReference(
                "/Users/nita/Primary/projects/ad-model-\n" +
                    "  training-archive/stages/\n" +
                    "  S27_full64_tpot_targeted_ceiling_trace/\n" +
                    "  README.md:388"
            )
        ).toEqual({
            rawText:
                "/Users/nita/Primary/projects/ad-model-training-archive/stages/S27_full64_tpot_targeted_ceiling_trace/README.md:388",
            filePath:
                "/Users/nita/Primary/projects/ad-model-training-archive/stages/S27_full64_tpot_targeted_ceiling_trace/README.md",
            lineNumber: 388,
            columnNumber: undefined,
            endLineNumber: undefined,
        });
    });
});
