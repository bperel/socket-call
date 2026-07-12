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

  it("exposes the passed socket as _socket while still forwarding emits", () => {
    const emit = mock(() => true);
    const socket = { data: { user: "alice" }, nsp: { name: "/ns" } };
    const events = getServerSentEvents<ServerEvents, typeof socket>(
      { emit },
      socket,
    );

    expect(events._socket).toBe(socket);
    expect(events._socket.data.user).toBe("alice");

    events.notify("hello", 1);
    expect(emit).toHaveBeenCalledWith("notify", "hello", 1);
  });

  it("treats _socket as a normal event name when no socket is passed", () => {
    const emit = mock(() => true);
    const events = getServerSentEvents<ServerEvents>({ emit });

    (events as any)._socket();

    expect(emit).toHaveBeenCalledWith("_socket");
  });
});
