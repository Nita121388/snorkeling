// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { parseBannerFromFrontmatter, hasBannerProperty } from "./banner-block";

describe("parseBannerFromFrontmatter", () => {
    it("should parse valid banner properties", () => {
        const data = {
            banner: "[[path/to/image.png]]",
            banner_y: 0.5,
            banner_lock: true,
        };

        const result = parseBannerFromFrontmatter(data);

        expect(result).not.toBeNull();
        expect(result!.banner).toBe("path/to/image.png");
        expect(result!.bannerY).toBe(0.5);
        expect(result!.bannerLock).toBe(true);
    });

    it("should handle direct path without wikilink", () => {
        const data = {
            banner: "path/to/image.png",
        };

        const result = parseBannerFromFrontmatter(data);

        expect(result).not.toBeNull();
        expect(result!.banner).toBe("path/to/image.png");
        expect(result!.bannerY).toBe(0.5); // default
        expect(result!.bannerLock).toBe(false); // default
    });

    it("should return null when banner property is missing", () => {
        const data = {
            other: "value",
        };

        const result = parseBannerFromFrontmatter(data);

        expect(result).toBeNull();
    });

    it("should return null when banner property is empty", () => {
        const data = {
            banner: "",
        };

        const result = parseBannerFromFrontmatter(data);

        expect(result).toBeNull();
    });

    it("should clamp banner_y to valid range", () => {
        const data1 = { banner: "image.png", banner_y: -0.5 };
        const data2 = { banner: "image.png", banner_y: 1.5 };

        const result1 = parseBannerFromFrontmatter(data1);
        const result2 = parseBannerFromFrontmatter(data2);

        expect(result1!.bannerY).toBe(0);
        expect(result2!.bannerY).toBe(1);
    });

    it("should handle non-numeric banner_y", () => {
        const data = {
            banner: "image.png",
            banner_y: "invalid",
        };

        const result = parseBannerFromFrontmatter(data);

        expect(result).not.toBeNull();
        expect(result!.bannerY).toBe(0.5); // default
    });

    it("should handle non-boolean banner_lock", () => {
        const data = {
            banner: "image.png",
            banner_lock: "yes",
        };

        const result = parseBannerFromFrontmatter(data);

        expect(result).not.toBeNull();
        expect(result!.bannerLock).toBe(false); // default
    });
});

describe("hasBannerProperty", () => {
    it("should return true when banner property exists", () => {
        const data = { banner: "[[image.png]]" };
        expect(hasBannerProperty(data)).toBe(true);
    });

    it("should return false when banner property is missing", () => {
        const data = { other: "value" };
        expect(hasBannerProperty(data)).toBe(false);
    });

    it("should return false when banner property is empty", () => {
        const data = { banner: "" };
        expect(hasBannerProperty(data)).toBe(false);
    });

    it("should return false when banner property is not a string", () => {
        const data = { banner: 123 };
        expect(hasBannerProperty(data)).toBe(false);
    });
});
