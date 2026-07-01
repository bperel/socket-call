import { describe, expect, it, mock } from "bun:test";
import { getServerSentEvents } from "../index";

type ServerEvents = {
  notify: (message: string, count: number) => void;
  ping: () => void;
};

describe("getServerSentEvents", () => {
  it("forwards a call to target.emit with the event name and args", () => {
    const emit = mock(() => true);
    const events = getServerSentEvents<ServerEvents>({ emit });

    events.notify("hello", 3);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("notify", "hello", 3);
  });

  it("emits the event name alone for no-arg events", () => {
    const emit = mock(() => true);
    const events = getServerSentEvents<ServerEvents>({ emit });

    events.ping();

    expect(emit).toHaveBeenCalledWith("ping");
  });

  it("uses the accessed property as the event name for each call", () => {
    const emit = mock(() => true);
    const events = getServerSentEvents<ServerEvents>({ emit });

    events.ping();
    events.notify("again", 1);

    expect(emit.mock.calls).toEqual([["ping"], ["notify", "again", 1]]);
  });

  it("works with any EmitTarget (Socket / Namespace / emitter shape)", () => {
    // A Namespace-like or emitter-like object: anything with an `emit`.
    const emitted: unknown[][] = [];
    const namespace = {
      emit: (...args: unknown[]) => {
        emitted.push(args);
        return true;
      },
    };

    const events = getServerSentEvents<ServerEvents>(namespace);
    events.notify("broadcast", 42);

    expect(emitted).toEqual([["notify", "broadcast", 42]]);
  });
});
