// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import { i18n } from "@/i18n/config";
import "./quickelems.scss";

function CenteredLoadingDiv() {
    return <CenteredDiv>{i18n.t("common:common.loading")}</CenteredDiv>;
}

function CenteredDiv({ children }: { children: React.ReactNode }) {
    return (
        <div className="centered-div">
            <div>{children}</div>
        </div>
    );
}

export { CenteredDiv, CenteredLoadingDiv };
