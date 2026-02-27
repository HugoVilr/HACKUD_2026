export interface SessionState {
  unlocked: boolean;
  autolockAt?: number;
}

let state: SessionState = { unlocked: false };

export const getSessionState = (): SessionState => state;
export const setSessionState = (next: SessionState): void => {
  state = next;
};
