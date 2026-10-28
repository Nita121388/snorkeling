// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { useSyncExternalStore } from "react";
import { getAgentPersonaSnapshot, subscribeAgentPersonas, type PersonaMap } from "./persona-store";

/**
 * Jotai mirror of the provider persona store, for non-component contexts such as
 * `TermViewModel.viewIcon`. Kept in sync by the module-level subscription below.
 */
export const agentPersonaAtom = atom<PersonaMap>(getAgentPersonaSnapshot());

subscribeAgentPersonas(() => {
    globalStore.set(agentPersonaAtom, getAgentPersonaSnapshot());
});

/** Subscribe a component to the provider persona map (re-renders on change). */
export function useAgentPersonas(): PersonaMap {
    return useSyncExternalStore(
        subscribeAgentPersonas,
        getAgentPersonaSnapshot,
        getAgentPersonaSnapshot
    );
}
