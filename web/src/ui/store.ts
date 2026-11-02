// A minimal observable store. The app wraps setState with transitionAppState (ui/stateTransitions.ts)
// so every reset rule runs on every change; nothing else writes app state.

export interface Store<State> {
  getState(): State;
  /** Merges the patch shallowly into the state, then notifies every subscriber. */
  setState(patch: Partial<State>): void;
  /** Calls the listener after every setState; the returned function unsubscribes it. */
  subscribe(listener: (state: State) => void): () => void;
}

export function createStore<State>(initial: State): Store<State> {
  let currentState = initial;
  const listeners = new Set<(state: State) => void>();

  return {
    getState: () => currentState,
    setState: (patch) => {
      currentState = { ...currentState, ...patch };
      for (const listener of [...listeners]) {
        listener(currentState);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
