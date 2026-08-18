import { describe, expect, it } from "vitest";
import { resolvePreviewSaveTarget, type PreviewSaveTargetViewModel } from "./save-preview-draft";

function previewVm(handleFileSave: (() => Promise<void>) | undefined): PreviewSaveTargetViewModel {
    return { viewType: "preview", handleFileSave };
}

describe("resolvePreviewSaveTarget", () => {
    it("returns null when the focused block id is missing or blank", () => {
        const getViewModel = () => ({ viewModel: previewVm(async () => {}) });
        expect(resolvePreviewSaveTarget(null, getViewModel)).toBeNull();
        expect(resolvePreviewSaveTarget(undefined, getViewModel)).toBeNull();
        expect(resolvePreviewSaveTarget("", getViewModel)).toBeNull();
    });

    it("returns null when there is no block model for the focused block", () => {
        expect(resolvePreviewSaveTarget("b1", () => undefined)).toBeNull();
    });

    it("returns null for a non-preview view type", () => {
        expect(resolvePreviewSaveTarget("b1", () => ({ viewModel: { viewType: "term" } }))).toBeNull();
    });

    it("returns null for a preview model without handleFileSave", () => {
        expect(resolvePreviewSaveTarget("b1", () => ({ viewModel: previewVm(undefined) }))).toBeNull();
    });

    it("returns the preview model when it can save", () => {
        const handleFileSave = async () => {};
        const target = resolvePreviewSaveTarget("b1", () => ({
            viewModel: previewVm(handleFileSave),
        }));
        expect(target).not.toBeNull();
        expect(target!.handleFileSave).toBe(handleFileSave);
    });
});
