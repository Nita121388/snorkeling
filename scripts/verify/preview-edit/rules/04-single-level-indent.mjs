// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 列表缩进只能有一层。
// 上一轮的根因之一：typography 快照已把 <li> 的 padding 给了编辑器根节点，
// 内层 <ul>/<ol> 又带 margin-left:1.5em + padding-left:.25em → 文字右移约 30px。

export default {
    id: "single-level-indent",
    why: "列表缩进不能叠层：编辑器内第一层 ul/ol 的 margin-left 与 padding-left 必须都是 0",
    run({ observation }) {
        const list = observation.during?.firstList;
        if (list == null) {
            return { skipped: true, detail: "该 case 的编辑态没有列表（段落/引用等），跳过" };
        }
        const marginOk = list.marginLeft === "0px";
        const paddingOk = list.paddingLeft === "0px";
        const markerOk = list.listStyleType === "none";
        return {
            pass: marginOk && paddingOk && markerOk,
            detail:
                `${list.tag} margin-left=${list.marginLeft} padding-left=${list.paddingLeft}` +
                ` list-style-type=${list.listStyleType}`,
            evidence: { marginOk, paddingOk, markerOk, firstList: list },
        };
    },
};
