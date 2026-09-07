import { describe, expect, it, mock } from "bun:test";
import type { Server } from "socket.io";
import { z } from "zod";
import { INTERNAL_ERROR, VALIDATION_ERROR, useSocketEvents } from "../index";
import { ev } from "../zod";

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

describe("ev (zod-validated events)", () => {
  it("passes validated arguments through to the handler", async () => {
    const { listeners } = connect(() => ({
      login: ev(
        z.string().min(3),
        z.number().int(),
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
        z.string().min(3),
        z.number().int(),
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
      login: ev(z.string().min(3))(handler),
    }));

    await call(listeners, "login", "b");

    expect(handler).not.toHaveBeenCalled();
  });

  it("applies coercions before the handler sees the argument", async () => {
    const { listeners } = connect(() => ({
      login: ev(z.coerce.number().int())(async (age) => typeof age),
    }));

    expect((await call(listeners, "login", "38")).acked).toBe("number");
  });

  it("supports no-argument events", async () => {
    const { listeners } = connect(() => ({ ping: ev()(async () => "pong") }));

    expect((await call(listeners, "ping")).acked).toBe("pong");
  });

  it("reports a nested path inside an object argument", async () => {
    const { listeners } = connect(() => ({
      register: ev(z.object({ email: z.string().email() }))(
        async ({ email }) => email,
      ),
    }));

    const { acked } = (await call(listeners, "register", {
      email: "nope",
    })) as { acked: { errorDetails: string } };

    expect(acked.errorDetails).toContain("0.email:");
  });
});
