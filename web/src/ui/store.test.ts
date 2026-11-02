import { describe, expect, it } from "vitest";
import { createStore } from "./store";

interface CounterState {
  readonly countValue: number;
  readonly labelText: string;
}

describe("createStore", () => {
  it("returns the initial state", () => {
    const store = createStore<CounterState>({ countValue: 1, labelText: "one" });
    expect(store.getState()).toEqual({ countValue: 1, labelText: "one" });
  });

  it("merges a patch shallowly, keeping the fields it does not name", () => {
    const store = createStore<CounterState>({ countValue: 1, labelText: "one" });
    store.setState({ countValue: 2 });
    expect(store.getState()).toEqual({ countValue: 2, labelText: "one" });
  });

  it("notifies every subscriber with the new state after setState", () => {
    const store = createStore<CounterState>({ countValue: 1, labelText: "one" });
    const firstSeenStates: CounterState[] = [];
    const secondSeenStates: CounterState[] = [];
    store.subscribe((state) => firstSeenStates.push(state));
    store.subscribe((state) => secondSeenStates.push(state));
    store.setState({ labelText: "uno" });
    expect(firstSeenStates).toEqual([{ countValue: 1, labelText: "uno" }]);
    expect(secondSeenStates).toEqual([{ countValue: 1, labelText: "uno" }]);
  });

  it("stops notifying a subscriber after it unsubscribes", () => {
    const store = createStore<CounterState>({ countValue: 1, labelText: "one" });
    const seenCountValues: number[] = [];
    const unsubscribe = store.subscribe((state) => seenCountValues.push(state.countValue));
    store.setState({ countValue: 2 });
    unsubscribe();
    store.setState({ countValue: 3 });
    expect(seenCountValues).toEqual([2]);
    expect(store.getState().countValue).toBe(3);
  });
});
