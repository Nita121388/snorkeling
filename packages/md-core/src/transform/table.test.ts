// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import {
    caretToTableCoord,
    deleteTableColumn,
    deleteTableRow,
    findTableBounds,
    getColumnAlign,
    getTableCellText,
    insertTableColumn,
    insertTableColumnAtBoundary,
    insertTableRow,
    insertTableRowAtBoundary,
    moveTableColumn,
    moveTableRow,
    setColumnAlign,
    setTableCellText,
    tableRenderedRowCount,
} from "./table";

const TABLE = "| name | age |\n| --- | --- |\n| amy | 3 |\n| bob | 5 |";

describe("findTableBounds", () => {
    test("locates the whole table from any row", () => {
        expect(findTableBounds(TABLE, 1)).toEqual({ start: 0, end: 3 });
        expect(findTableBounds(TABLE, 3)).toEqual({ start: 0, end: 3 });
        expect(findTableBounds("text\n" + TABLE, 4)).toEqual({ start: 1, end: 4 });
    });

    test("non-table lines → null", () => {
        expect(findTableBounds("just text", 1)).toBeNull();
        expect(findTableBounds("| a |\nno separator", 1)).toBeNull();
    });
});

describe("insertTableRow", () => {
    test("below a data row", () => {
        const out = insertTableRow(TABLE, 3);
        expect(out).toBe(TABLE.replace("| amy | 3 |", "| amy | 3 |\n|  |  |"));
    });

    test("anchor on the header inserts the first data row (below the separator)", () => {
        const out = insertTableRow(TABLE, 1);
        expect(out).toBe("| name | age |\n| --- | --- |\n|  |  |\n| amy | 3 |\n| bob | 5 |");
    });

    test("anchor on the separator also inserts the first data row", () => {
        const out = insertTableRow(TABLE, 2);
        expect(out).toContain("| --- | --- |\n|  |  |\n");
    });

    test("non-table → null", () => {
        expect(insertTableRow("plain", 1)).toBeNull();
    });
});

describe("deleteTableRow", () => {
    test("deletes a data row", () => {
        expect(deleteTableRow(TABLE, 3)).toBe("| name | age |\n| --- | --- |\n| bob | 5 |");
    });

    test("deleting the header promotes the first data row", () => {
        expect(deleteTableRow(TABLE, 1)).toBe("| amy | 3 |\n| --- | --- |\n| bob | 5 |");
    });

    test("refuses to delete the separator row", () => {
        expect(deleteTableRow(TABLE, 2)).toBeNull();
    });

    test("refuses to delete the header of a header-only table", () => {
        expect(deleteTableRow("| a |\n| --- |", 1)).toBeNull();
    });
});

describe("insertTableColumn", () => {
    test("left of column 0 adds a leading blank column to every row", () => {
        const out = insertTableColumn(TABLE, 1, 0, "left");
        expect(out).toBe("|  | name | age |\n| --- | --- | --- |\n|  | amy | 3 |\n|  | bob | 5 |");
    });

    test("right of last column appends", () => {
        const out = insertTableColumn(TABLE, 3, 1, "right");
        expect(out).toBe("| name | age |  |\n| --- | --- | --- |\n| amy | 3 |  |\n| bob | 5 |  |");
    });
});

describe("deleteTableColumn", () => {
    test("removes the column from every row", () => {
        expect(deleteTableColumn(TABLE, 2, 0)).toBe("| age |\n| --- |\n| 3 |\n| 5 |");
    });

    test("refuses to delete the last remaining column", () => {
        expect(deleteTableColumn("| only |\n| --- |\n| x |", 1, 0)).toBeNull();
    });

    test("out-of-range column → null", () => {
        expect(deleteTableColumn(TABLE, 1, 5)).toBeNull();
    });
});

describe("setColumnAlign / getColumnAlign", () => {
    test("cycles left / center / right on the separator row only", () => {
        const left = setColumnAlign(TABLE, 1, 0, "left");
        expect(left).toBe("| name | age |\n| :--- | --- |\n| amy | 3 |\n| bob | 5 |");
        expect(getColumnAlign(left!, 1, 0)).toBe("left");
        const center = setColumnAlign(left!, 3, 0, "center");
        expect(center).toContain("| :---: | --- |");
        expect(getColumnAlign(center!, 1, 0)).toBe("center");
        const right = setColumnAlign(center!, 2, 1, "right");
        expect(right).toContain("| :---: | ---: |");
        expect(getColumnAlign(right!, 1, 1)).toBe("right");
    });

    test("default alignment reads back as 'default'", () => {
        expect(getColumnAlign(TABLE, 1, 0)).toBe("default");
    });

    test("bad column → null", () => {
        expect(setColumnAlign(TABLE, 1, 9, "left")).toBeNull();
        expect(getColumnAlign(TABLE, 1, 9)).toBeNull();
    });
});

describe("caretToTableCoord", () => {
    test("maps caret offsets to (row, col)", () => {
        // "| name | age |": caret after "| name |" → col 1
        expect(caretToTableCoord("| name | age |\n| --- | --- |", 0)).toEqual({ row: 0, col: 0 });
        expect(caretToTableCoord("| name | age |\n| --- | --- |", 9)).toEqual({ row: 0, col: 1 });
        expect(caretToTableCoord("| name | age |\n| --- | --- |", 15)).toEqual({ row: 1, col: 0 });
    });

    test("out-of-range caret → null", () => {
        expect(caretToTableCoord("| a |", 99)).toBeNull();
    });
});

describe("rendered-row coordinates (M7)", () => {
    const T3 = "| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |";

    test("tableRenderedRowCount counts header + data rows, not the separator", () => {
        expect(tableRenderedRowCount(T3, 1)).toBe(3);
        expect(tableRenderedRowCount("not a table", 1)).toBe(0);
    });

    test("getTableCellText reads header and data cells", () => {
        expect(getTableCellText(T3, 1, 0, 1)).toBe("h2");
        expect(getTableCellText(T3, 1, 2, 0)).toBe("c");
        expect(getTableCellText(T3, 1, 3, 0)).toBeNull();
        expect(getTableCellText(T3, 1, 0, 5)).toBeNull();
    });

    test("setTableCellText rewrites exactly one cell, canonically", () => {
        expect(setTableCellText(T3, 1, 1, 1, "B **x**")).toBe(
            "| h1 | h2 |\n| --- | --- |\n| a | B **x** |\n| c | d |"
        );
    });

    test("setTableCellText can rewrite the header cell", () => {
        expect(setTableCellText(T3, 1, 0, 0, "H1")).toBe(
            "| H1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |"
        );
    });

    test("setTableCellText no-ops on identical / out-of-range input", () => {
        expect(setTableCellText(T3, 1, 1, 0, "a")).toBeNull();
        expect(setTableCellText(T3, 1, 9, 0, "x")).toBeNull();
        expect(setTableCellText(T3, 1, 0, 4, "x")).toBeNull();
    });

    test("setTableCellText keeps escaped pipes intact in sibling cells", () => {
        const t = "| a \\| x | b |\n| --- | --- |\n| 1 | 2 |";
        expect(setTableCellText(t, 1, 1, 1, "y")).toBe("| a \\| x | b |\n| --- | --- |\n| 1 | y |");
        expect(getTableCellText(t, 1, 0, 0)).toBe("a \\| x");
    });
});

describe("insertTableRowAtBoundary / insertTableColumnAtBoundary", () => {
    const T2 = "| h1 | h2 |\n| --- | --- |\n| a | b |";

    test("boundary 1 = first data row (never above the header)", () => {
        expect(insertTableRowAtBoundary(T2, 1, 1)).toBe("| h1 | h2 |\n| --- | --- |\n|  |  |\n| a | b |");
        expect(insertTableRowAtBoundary(T2, 1, 0)).toBeNull();
    });

    test("boundary rowCount = append last", () => {
        expect(insertTableRowAtBoundary(T2, 1, 2)).toBe("| h1 | h2 |\n| --- | --- |\n| a | b |\n|  |  |");
    });

    test("column boundary 0 = leftmost, cols = rightmost, separator gets ---", () => {
        expect(insertTableColumnAtBoundary(T2, 1, 0)).toBe(
            "|  | h1 | h2 |\n| --- | --- | --- |\n|  | a | b |"
        );
        expect(insertTableColumnAtBoundary(T2, 1, 2)).toBe(
            "| h1 | h2 |  |\n| --- | --- | --- |\n| a | b |  |"
        );
        expect(insertTableColumnAtBoundary(T2, 1, 3)).toBeNull();
        expect(insertTableColumnAtBoundary(T2, 1, -1)).toBeNull();
    });
});

describe("moveTableRow / moveTableColumn", () => {
    const T3 = "| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |\n| e | f |";

    test("moving a row down lands after the hovered row", () => {
        expect(moveTableRow(T3, 1, 1, 3)).toBe("| h1 | h2 |\n| --- | --- |\n| c | d |\n| a | b |\n| e | f |");
    });

    test("moving a row up lands before the hovered row", () => {
        expect(moveTableRow(T3, 1, 3, 1)).toBe("| h1 | h2 |\n| --- | --- |\n| e | f |\n| a | b |\n| c | d |");
    });

    test("a data row dropped on the header gap becomes the new header (GFM reality)", () => {
        expect(moveTableRow(T3, 1, 2, 0)).toBe("| c | d |\n| --- | --- |\n| h1 | h2 |\n| a | b |\n| e | f |");
    });

    test("no-op boundaries return null", () => {
        expect(moveTableRow(T3, 1, 1, 1)).toBeNull();
        expect(moveTableRow(T3, 1, 1, 2)).toBeNull();
        expect(moveTableRow(T3, 1, 9, 1)).toBeNull();
        expect(moveTableRow(T3, 1, 1, 99)).toBeNull();
    });

    test("moving a column right moves header, separator and data together", () => {
        expect(moveTableColumn(T3, 1, 0, 2)).toBe(
            "| h2 | h1 |\n| --- | --- |\n| b | a |\n| d | c |\n| f | e |"
        );
    });

    test("moving a column left", () => {
        expect(moveTableColumn(T3, 1, 2, 0)).toBeNull(); // only 2 cols → out of range
        expect(moveTableColumn("| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |", 1, 2, 0)).toBe(
            "| c | a | b |\n| - | - | - |\n| 3 | 1 | 2 |"
        );
    });
});
