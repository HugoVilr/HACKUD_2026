import type { VaultEntry } from "../../../core/vault/types.ts";
import type { PopupRoute, PopupState } from "./popupState.ts";

export const setRoute = (state: PopupState, route: PopupRoute): void => {
  state.route = route;
  state.formPasswordVisible = false;
  state.detailPasswordVisible = false;
  state.selectedSecret = null;
  state.search = "";
  state.screen = "LIST";
  state.selectedEntryId = null;
};

export const selectEntry = (state: PopupState, entryId: string): void => {
  state.selectedEntryId = entryId;
  state.detailPasswordVisible = false;
  state.selectedSecret = null;
  state.screen = "DETAIL";
};

export const getSelectedEntry = (state: PopupState): VaultEntry | null => {
  return state.entries.find((entry) => entry.id === state.selectedEntryId) ?? null;
};
