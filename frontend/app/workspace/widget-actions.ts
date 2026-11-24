// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { openCommonTextSearch } from "@/app/commontext/commontext-events";
import { modalsModel } from "@/app/store/modalmodel";

const CommonTextSearchWidgetAction = "commontext:search";
// 定时任务管理面：action 打开弹窗，不建 Block（11-24-schedtask-entry-fix）。
// 老的 scheduledtasks Block 视图保留可用，只是不再是 widget 的默认动作。
const ScheduledTaskManagerWidgetAction = "scheduledtasks:manager";

function runWidgetAction(action?: string): boolean {
    if (action == null || action === "") {
        return false;
    }
    switch (action) {
        case CommonTextSearchWidgetAction:
            openCommonTextSearch();
            return true;
        case ScheduledTaskManagerWidgetAction:
            modalsModel.pushModal("ScheduledTaskManagerModal", {});
            return true;
        default:
            console.warn(`Unknown widget action: ${action}`);
            return false;
    }
}

export { CommonTextSearchWidgetAction, ScheduledTaskManagerWidgetAction, runWidgetAction };
