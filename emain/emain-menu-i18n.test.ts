import { beforeEach, describe, expect, test } from "vitest";
import { initI18nMain, resetI18nMainForTest, setMainLocale, tmew } from "./emain-i18n";

beforeEach(async () => { resetI18nMainForTest(); initI18nMain("en"); });

describe("native menu labels are localized in main process", () => {
    test("menu keys resolve to Chinese after switching to zh", async () => {
        await setMainLocale("zh");
        expect(tmew("common:menu.app.about")).toBe("关于 Snorkeling");
        expect(tmew("common:menu.app.checkForUpdates")).toBe("检查更新");
        expect(tmew("common:menu.view.toggleWidgetsBar")).toBeTruthy();
        expect(tmew("common:menu.view.toggleWidgetsBar")).not.toBe("common:menu.view.toggleWidgetsBar");
    });
    test("updater + notify + dialog keys resolve in zh", async () => {
        await setMainLocale("zh");
        expect(tmew("common:dialog.confirmQuit.title")).toBe("确认退出");
        for (const k of ["common:updater.downloadInstall", "common:osNotify.doneTitle", "common:menu.workspace.label"]) {
            const v = tmew(k);
            expect(v, k).toBeTruthy();
            expect(v, k).not.toBe(k);
            expect(v, k).toMatch(/[\u4e00-\u9fff]/);
        }
    });
});
