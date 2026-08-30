// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import {
    caretToTableCoord,
    deleteTableColumn,
    deleteTableRow,
    findTableBounds,
    getColumnAlign,
    insertTableColumn,
    insertTableRow,
    setColumnAlign,
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
