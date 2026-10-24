// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// InfoCard 对外统一出口。

export {
    InfoCard,
    InfoCardEmpty,
    InfoCardError,
    InfoCardHead,
    InfoCardIcon,
    InfoCardInput,
    InfoCardMeta,
    InfoCardPreview,
    InfoCardSection,
    InfoCardStatus,
    InfoCardText,
    InfoCardTitle,
} from "./info-card";
export { InfoCardPortal, useInfoCardDismiss, useInfoCardHover } from "./info-card-hover";
export { InfoCardMarquee, isMarqueeNeeded, marqueeDurationSec } from "./marquee";
export type { InfoCardMarqueeProps } from "./marquee";
export type { InfoCardHoverState, InfoCardPlacement } from "./info-card-hover";
export {
    claimInfoCard,
    isInfoCardClaimedBy,
    releaseInfoCard,
    subscribeInfoCard,
} from "./info-card-global";
