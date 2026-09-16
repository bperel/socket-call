import { describe, expect, it, mock } from "bun:test";
import type { Server } from "socket.io";
import * as v from "valibot";
import { INTERNAL_ERROR, VALIDATION_ERROR, useSocketEvents } from "../index";
import { ev } from "../valibot";

/**
 * Minimal `io` stand-in: `server(io)` wires the namespace and immediately
 * fires a connection, so the captured listeners can be invoked directly.
 */
const connect = (
  listenEvents: Parameters<typeof useSocketEvents>[1]["listenEvents"],
) => {
  const listeners: Record<string, (...args: unknown[]) => Promise<void>> = {};
  const socket = {
    on: (event: string, cb: (...args: unknown[]) => Promise<void>) => {
      listeners[event] = cb;
    },
    emit: () => true,
    data: {} as Record<string, unknown>,
  };
  const namespace = {
    use: () => {},
    on: (_: string, cb: (s: typeof socket) => void) => cb(socket),
  };
  const onEventError = mock(() => {});
  const { server } = useSocketEvents("/t", {
    listenEvents,
    middlewares: [],
    onEventError,
  });
  server({ of: () => namespace } as unknown as Server);
  return { listeners, socket, onEventError };
};

/** Emit an event the way socket.io does, and resolve with the acked payload. */
const call = async (
  listeners: Record<string, (...args: unknown[]) => Promise<void>>,
  event: string,
  ...args: unknown[]
) => {
  let acked: unknown;
  let ackCount = 0;
  await listeners[event](...args, (output: unknown) => {
    acked = output;
    ackCount++;
  });
  return { acked, ackCount };
};

describe("dispatcher", () => {
  it("acks the handler's return value", async () => {
    const { listeners } = connect(() => ({
      double: async (n: number) => n * 2,
    }));

    expect(await call(listeners, "double", 21)).toEqual({
      acked: 42,
      ackCount: 1,
    });
  });

  it("acks INTERNAL_ERROR instead of rejecting when a handler throws", async () => {
    const { listeners, onEventError } = connect(() => ({
      boom: async () => {
        throw new Error("kaboom");
      },
    }));

    const { acked, ackCount } = await call(listeners, "boom");

    expect(acked).toEqual({ error: INTERNAL_ERROR });
    expect(ackCount).toBe(1);
    expect(onEventError).toHaveBeenCalledTimes(1);
  });

  it("does not leak the internal error message to the client", async () => {
    const { listeners } = connect(() => ({
      boom: async () => {
        throw new Error("connection string: postgres://secret");
      },
    }));

    const { acked } = await call(listeners, "boom");

    expect(JSON.stringify(acked)).not.toContain("secret");
  });

  it("tolerates an emit with no ack callback", async () => {
    const handler = mock(async (_n: number) => "ok");
    const { listeners } = connect(() => ({ fire: handler }));

    await listeners.fire(1);

    expect(handler).toHaveBeenCalledWith(1);
  });

  it("still acks once when a callback-less emit throws", async () => {
    const { listeners, onEventError } = connect(() => ({
      boom: async () => {
        throw new Error("kaboom");
      },
    }));

    await listeners.boom();

    expect(onEventError).toHaveBeenCalledTimes(1);
  });
});

describe("ev (validated events)", () => {
  it("passes validated arguments through to the handler", async () => {
    const { listeners } = connect(() => ({
      login: ev(
        v.pipe(v.string(), v.minLength(3)),
        v.pipe(v.number(), v.integer()),
      )(async (username, age) => `${username}:${age}`),
    }));

    expect(await call(listeners, "login", "bruno", 38)).toEqual({
      acked: "bruno:38",
      ackCount: 1,
    });
  });

  it("acks VALIDATION_ERROR with every issue and its argument index", async () => {
    const { listeners } = connect(() => ({
      login: ev(
        v.pipe(v.string(), v.minLength(3)),
        v.pipe(v.number(), v.integer()),
      )(async (username, age) => `${username}:${age}`),
    }));

    const { acked } = (await call(listeners, "login", "b", 1.5)) as {
      acked: { error: string; errorDetails: string };
    };

    expect(acked.error).toBe(VALIDATION_ERROR);
    expect(acked.errorDetails).toContain("0:");
    expect(acked.errorDetails).toContain("1:");
  });

  it("never runs the handler on invalid input", async () => {
    const handler = mock(async (_username: string) => "ran");
    const { listeners } = connect(() => ({
      login: ev(v.pipe(v.string(), v.minLength(3)))(handler),
    }));

    await call(listeners, "login", "b");

    expect(handler).not.toHaveBeenCalled();
  });

  it("applies coercions before the handler sees the argument", async () => {
    const { listeners } = connect(() => ({
      login: ev(v.pipe(v.unknown(), v.transform(Number), v.integer()))(
        async (age) => typeof age,
      ),
    }));

    expect((await call(listeners, "login", "38")).acked).toBe("number");
  });

  it("runs the handler when a trailing optional argument is not emitted", async () => {
    const { listeners } = connect(() => ({
      createEntry: ev(
        v.number(),
        v.optional(v.number()),
      )(async (position, parentId) => `${position}:${parentId}`),
    }));

    expect((await call(listeners, "createEntry", 3)).acked).toBe("3:undefined");
  });

  it("falls back to the default of a trailing argument that is not emitted", async () => {
    const { listeners } = connect(() => ({
      createEntry: ev(
        v.number(),
        v.optional(v.number(), 0),
      )(async (position, parentId) => `${position}:${parentId}`),
    }));

    expect((await call(listeners, "createEntry", 3)).acked).toBe("3:0");
  });

  it("accepts every arity when several trailing arguments are optional", async () => {
    const { listeners } = connect(() => ({
      createEntry: ev(
        v.number(),
        v.optional(v.number()),
        v.optional(v.string(), "x"),
      )(async (...args) => JSON.stringify(args)),
    }));

    expect((await call(listeners, "createEntry", 3)).acked).toBe(
      '[3,null,"x"]',
    );
    expect((await call(listeners, "createEntry", 3, 4)).acked).toBe(
      '[3,4,"x"]',
    );
    expect((await call(listeners, "createEntry", 3, 4, "c")).acked).toBe(
      '[3,4,"c"]',
    );
  });

  it("still validates a trailing optional argument that is emitted", async () => {
    const { listeners } = connect(() => ({
      createEntry: ev(
        v.number(),
        v.optional(v.number()),
      )(async (position, parentId) => `${position}:${parentId}`),
    }));

    const { acked } = (await call(listeners, "createEntry", 3, "nope")) as {
      acked: { error: string; errorDetails: string };
    };

    expect(acked.error).toBe(VALIDATION_ERROR);
    expect(acked.errorDetails).toContain("1:");
  });

  it("supports no-argument events", async () => {
    const { listeners } = connect(() => ({ ping: ev()(async () => "pong") }));

    expect((await call(listeners, "ping")).acked).toBe("pong");
  });

  it("acks a declared message as a plain error payload", async () => {
    const { listeners } = connect(() => ({
      login: ev(v.pipe(v.string(), v.minLength(3, "Username is too short")))(
        async (username) => username,
      ),
    }));

    expect(await call(listeners, "login", "b")).toEqual({
      acked: { error: "Username is too short" },
      ackCount: 1,
    });
  });

  it("picks the message of the action that rejected", async () => {
    const { listeners } = connect(() => ({
      login: ev(
        v.pipe(
          v.string(),
          v.minLength(3, "Username is too short"),
          v.maxLength(6, "Username is too long"),
        ),
      )(async (username) => username),
    }));

    expect((await call(listeners, "login", "b")).acked).toEqual({
      error: "Username is too short",
    });
    expect((await call(listeners, "login", "bruuuuuno")).acked).toEqual({
      error: "Username is too long",
    });
  });

  it("unions messages declared across several arguments", async () => {
    const { listeners } = connect(() => ({
      login: ev(
        v.pipe(v.string(), v.minLength(3, "Username is too short")),
        v.pipe(v.number(), v.integer("Age must be whole")),
      )(async (username, age) => `${username}:${age}`),
    }));

    expect((await call(listeners, "login", "bruno", 1.5)).acked).toEqual({
      error: "Age must be whole",
    });
    expect((await call(listeners, "login", "b", 38)).acked).toEqual({
      error: "Username is too short",
    });
  });

  it("never runs the handler behind a declared message", async () => {
    const handler = mock(async (_username: string) => "ran");
    const { listeners } = connect(() => ({
      login: ev(v.pipe(v.string(), v.minLength(3, "Username is too short")))(
        handler,
      ),
    }));

    await call(listeners, "login", "b");

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not report a declared rejection as a handler failure", async () => {
    const { listeners, onEventError } = connect(() => ({
      login: ev(v.pipe(v.string(), v.minLength(3, "Username is too short")))(
        async (username) => username,
      ),
    }));

    await call(listeners, "login", "b");

    expect(onEventError).not.toHaveBeenCalled();
  });

  it("does not report an undeclared rejection as a handler failure", async () => {
    const { listeners, onEventError } = connect(() => ({
      login: ev(v.pipe(v.string(), v.minLength(3)))(async (u) => u),
    }));

    await call(listeners, "login", "b");

    expect(onEventError).not.toHaveBeenCalled();
  });

  it("keeps errorDetails when falling back to VALIDATION_ERROR", async () => {
    const { listeners } = connect(() => ({
      login: ev(
        v.pipe(v.string(), v.minLength(3, "Username is too short")),
        v.pipe(v.number(), v.integer()),
      )(async (u, n) => `${u}${n}`),
    }));

    expect((await call(listeners, "login", "bruno", 1.5)).acked).toEqual({
      error: VALIDATION_ERROR,
      errorDetails: "1: Invalid integer: Received 1.5",
    });
  });

  it("still acks VALIDATION_ERROR for a rejection with no message", async () => {
    const { listeners } = connect(() => ({
      // the type mismatch is reported by the schema, which declared no message
      login: ev(v.pipe(v.string(), v.minLength(3, "Username is too short")))(
        async (username) => username,
      ),
    }));

    const { acked } = (await call(listeners, "login", 42)) as {
      acked: { error: string };
    };

    expect(acked.error).toBe(VALIDATION_ERROR);
  });

  it("reports a nested path inside an object argument", async () => {
    const { listeners } = connect(() => ({
      register: ev(v.object({ email: v.pipe(v.string(), v.email()) }))(
        async ({ email }) => email,
      ),
    }));

    const { acked } = (await call(listeners, "register", {
      email: "nope",
    })) as { acked: { errorDetails: string } };

    expect(acked.errorDetails).toContain("0.email:");
  });
});
