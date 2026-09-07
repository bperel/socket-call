import {
  buildMemoryStorage,
  type CachedStorageValue,
  type NotEmptyStorageValue,
} from "axios-cache-interceptor";
import {
  AxiosStorage,
  SocketCallError,
  SocketClient,
  stringifyEventParameters,
  type Errorable,
  type ScopedError,
} from "../index";
import { expect, describe, mock, beforeEach, it, jest } from "bun:test";

type ClientEvents = {
  testEvent: (
    arg1: string,
    options?: { disableCache?: boolean },
  ) => Promise<{ data: string }>;
  failingEvent: (
    arg1: string,
  ) => Promise<Errorable<{ data: string }, "test error" | "invalid_username">>;
};

const mockSocket = {
  io: jest.fn(() => ({
    connect: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
    onAny: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    emitWithAck: jest.fn().mockResolvedValue({ data: "test" }),
  })),
};

const removeTimestamps = ([log]: unknown[]) =>
  String(log).replace(/ (?:in [^ ]+ )?at [^Z]+Z/, "");

const buildAxiosStorage = (
  cachedValue: Record<string, NotEmptyStorageValue>,
): AxiosStorage => ({
  set: (key, data) => {
    console.log("setting cache", key, data);
    cachedValue[key] = data;
  },
  get: async (key) => {
    console.log("getting cache", key);
    return cachedValue[key];
  },
  remove: jest.fn(),
  clear: jest.fn(),
});

describe("SocketClient", () => {
  let socketClient: SocketClient;

  beforeEach(() => {
    mock.module("socket.io-client", () => mockSocket);
    socketClient = new SocketClient("http://test.com/");
  });

  describe("constructor", () => {
    it("should create instance with socket root url", () => {
      expect(socketClient).toBeInstanceOf(SocketClient);
    });
  });

  describe("cacheHydrator", () => {
    it("should handle cache hydration process", async () => {
      const loadCache = jest.fn().mockResolvedValue(undefined);
      const loadReal = jest.fn();

      await socketClient.cacheHydrator.run(loadCache, loadReal);

      expect(loadCache).toHaveBeenCalled();
      expect(loadReal).toHaveBeenCalled();
      expect(socketClient.cacheHydrator.state.value?.mode).toBe("HYDRATE");
    });
  });

  describe("addNamespace", () => {
    it("should create namespace with basic configuration", () => {
      const namespace =
        socketClient.addNamespace<ClientEvents>("test-namespace");

      expect(namespace).toBeDefined();
      expect(namespace._socket).toBeUndefined();
      expect(typeof namespace._connect).toBe("function");
    });

    it("should handle connection with session token", () => {
      const mockToken = "test-token";
      const namespace = socketClient.addNamespace<ClientEvents>(
        "test-namespace",
        {
          session: {
            getToken: jest.fn().mockResolvedValue(mockToken),
            clearSession: jest.fn(),
            sessionExists: jest.fn().mockResolvedValue(true),
          },
        },
      );

      namespace._connect();

      expect(mockSocket.io).toHaveBeenCalledWith(
        "http://test.com/test-namespace",
        expect.objectContaining({
          extraHeaders: { "X-Namespace": "test-namespace" },
          transports: ["websocket"],
        }),
      );
    });

    it("should handle an event call", async () => {
      const namespace =
        socketClient.addNamespace<ClientEvents>("test-namespace");
      await namespace.testEvent("arg1");

      expect(namespace._socket!.emitWithAck).toHaveBeenCalledWith(
        "testEvent",
        "arg1",
      );
    });

    it("should store and restore cached responses", async () => {
      let cachedValue: Record<string, NotEmptyStorageValue> = {
        'test-namespace/testEvent ["arg2"]': {
          data: {
            data: { data: "cached" },
            headers: {},
            status: 200,
            statusText: "OK",
          },
          createdAt: 1,
          state: "cached",
          ttl: 1,
        },
      };
      const storage = buildAxiosStorage(cachedValue);
      const namespace = socketClient.addNamespace<ClientEvents>(
        "test-namespace",
        {
          cache: {
            ttl: 1,
            storage,
          },
        },
      );
      const cachedResponse = await namespace.testEvent("arg2");
      expect(cachedResponse).toEqual({ data: "cached" });

      const response = await namespace.testEvent("arg1");
      expect(response).toEqual({ data: "test" });
    });

    it("should not use cached responses when disableCache is true", async () => {
      const cachedValue: Record<string, NotEmptyStorageValue> = {
        'test-namespace/testEvent ["arg2"]': {
          data: { data: "cached", headers: {}, status: 200, statusText: "OK" },
          createdAt: 1,
          state: "cached",
          ttl: 1,
        },
      };

      const debugSpy = jest.spyOn(console, "debug");

      const namespace = socketClient.addNamespace<ClientEvents>(
        "test-namespace",
        {
          cache: {
            ttl: 1,
            storage: buildAxiosStorage(cachedValue),
          },
        },
      );

      const response = await namespace.testEvent("arg1", {
        disableCache: true,
      });
      expect(response).toEqual({ data: "test" });
      expect(debugSpy.mock.calls.map(removeTimestamps)).toEqual([
        'test-namespace/testEvent("arg1") called without token',
        'test-namespace/testEvent("arg1") responded',
      ]);
    });

    it("should keep the state of the data loader", async () => {
      const cachedValue: Record<string, NotEmptyStorageValue> = {
        'test-namespace/testEvent ["arg2"]': {
          data: { data: "cached", headers: {}, status: 200, statusText: "OK" },
          createdAt: 1,
          state: "cached",
          ttl: 1,
        },
      };
      const namespace = socketClient.addNamespace<ClientEvents>(
        "test-namespace",
        {
          cache: {
            ttl: 1,
            storage: buildAxiosStorage(cachedValue),
          },
        },
      );

      await socketClient.cacheHydrator.run(
        () =>
          namespace.testEvent("arg2").then(() => {
            expect(
              JSON.parse(
                JSON.stringify(
                  socketClient.cacheHydrator.state.value?.cachedCallsDone,
                ),
              ),
            ).toEqual(['test-namespace/testEvent("arg2")']);
          }),
        () => {
          expect(
            socketClient.cacheHydrator.state.value?.cachedCallsDone,
          ).toEqual([]);
        },
      );
    });
  });

  describe("cache expiry", () => {
    const cacheKey = 'test-namespace/testEvent ["arg2"]';

    /** A `cached` entry written `ageMs` ago, as the client itself writes them. */
    const entry = (
      payload: unknown,
      ageMs: number,
      ttl: number,
      staleTtl?: number,
    ): CachedStorageValue => ({
      state: "cached",
      createdAt: Date.now() - ageMs,
      ttl,
      staleTtl,
      data: { data: payload, headers: {}, status: 200, statusText: "OK" },
    });

    /**
     * Unlike `buildAxiosStorage`, a real memory storage runs the expiry rules,
     * which is the only way `ttl` and `staleTtl` are observable at all.
     */
    const withMemoryStorage = ({
      ttl,
      staleTtl,
      seed,
      offline = false,
    }: {
      ttl: number | ((event: string, args: unknown[]) => number);
      staleTtl?: number | ((event: string, args: unknown[]) => number);
      seed?: CachedStorageValue;
      offline?: boolean;
    }) => {
      mock.module("socket.io-client", () => ({
        io: jest.fn(() => {
          const socket: Record<string, unknown> = {
            connect: jest.fn(() => socket),
            onAny: jest.fn(() => socket),
            emit: jest.fn(),
            emitWithAck: jest.fn().mockResolvedValue({ data: "test" }),
            on: jest.fn((event: string, handler: (e: Error) => void) => {
              if (offline && event === "connect_error") {
                handler(new Error("offline"));
              }
              return socket;
            }),
          };
          return socket;
        }),
      }));

      const storage = buildMemoryStorage();
      const client = new SocketClient("http://test.com/");
      const namespace = client.addNamespace<ClientEvents>("test-namespace", {
        cache: { ttl, staleTtl, storage },
      });
      if (seed) storage.set(cacheKey, seed);
      return { client, namespace, storage };
    };

    it("should write the configured ttl and staleTtl alongside the entry", async () => {
      const { namespace, storage } = withMemoryStorage({
        ttl: 5000,
        staleTtl: 60000,
      });

      await namespace.testEvent("arg1");

      const stored = await storage.get('test-namespace/testEvent ["arg1"]');
      if (stored.state !== "cached") {
        throw new Error(`expected a cached entry, got ${stored.state}`);
      }
      expect(stored.ttl).toBe(5000);
      expect(stored.staleTtl).toBe(60000);
      expect(stored.data.data).toEqual({ data: "test" });
    });

    it("should resolve ttl and staleTtl given as functions", async () => {
      const { namespace, storage } = withMemoryStorage({
        ttl: (event) => (event === "testEvent" ? 1234 : 0),
        staleTtl: (_event, args) => (args.length === 1 ? 4321 : 0),
      });

      await namespace.testEvent("arg1");

      const stored = await storage.get('test-namespace/testEvent ["arg1"]');
      if (stored.state !== "cached") {
        throw new Error(`expected a cached entry, got ${stored.state}`);
      }
      expect(stored.ttl).toBe(1234);
      expect(stored.staleTtl).toBe(4321);
    });

    it("should serve an entry that is still within its ttl", async () => {
      const { namespace } = withMemoryStorage({
        ttl: 5000,
        seed: entry({ data: "cached" }, 10, 5000),
      });

      expect(await namespace.testEvent("arg2")).toEqual({ data: "cached" });
    });

    it("should refetch once the ttl elapsed and no staleTtl is set", async () => {
      const { namespace } = withMemoryStorage({
        ttl: 100,
        seed: entry({ data: "cached" }, 500, 100),
      });

      expect(await namespace.testEvent("arg2")).toEqual({ data: "test" });
    });

    it("should refetch an expired entry while online, even within staleTtl", async () => {
      const { namespace } = withMemoryStorage({
        ttl: 100,
        staleTtl: 5000,
        seed: entry({ data: "cached" }, 500, 100, 5000),
      });

      expect(await namespace.testEvent("arg2")).toEqual({ data: "test" });
    });

    it("should serve an expired entry within staleTtl while offline", async () => {
      const { namespace } = withMemoryStorage({
        ttl: 100,
        staleTtl: 5000,
        seed: entry({ data: "cached" }, 500, 100, 5000),
        offline: true,
      });

      expect(await namespace.testEvent("arg2")).toEqual({ data: "cached" });
    });

    it("should refetch offline once staleTtl elapsed too", async () => {
      const { namespace } = withMemoryStorage({
        ttl: 100,
        staleTtl: 5000,
        seed: entry({ data: "cached" }, 9000, 100, 5000),
        offline: true,
      });

      expect(await namespace.testEvent("arg2")).toEqual({ data: "test" });
    });

    it("should serve an expired entry within staleTtl while priming the cache", async () => {
      const { client, namespace } = withMemoryStorage({
        ttl: 100,
        staleTtl: 5000,
        seed: entry({ data: "cached" }, 500, 100, 5000),
      });

      await client.cacheHydrator.run(
        async () => {
          expect(await namespace.testEvent("arg2")).toEqual({ data: "cached" });
        },
        () => {},
      );
    });
  });

  describe("error handling", () => {
    beforeEach(() => {
      mock.module("socket.io-client", () => mockSocket);
      socketClient = new SocketClient("http://test.com/");
    });

    it("should handle connect error", () => {
      const errorSpy = jest.spyOn(console, "error");
      const error = new Error("connection failed");

      socketClient.onConnectError(error, "test-namespace");

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("test-namespace: connect_error"),
      );
    });

    const withAckResponse = (response: unknown) => {
      mock.module("socket.io-client", () => ({
        io: jest.fn(() => ({
          connect: jest.fn().mockReturnThis(),
          on: jest.fn().mockReturnThis(),
          onAny: jest.fn().mockReturnThis(),
          emit: jest.fn(),
          emitWithAck: jest.fn().mockResolvedValue(response),
        })),
      }));
      return new SocketClient("http://test.com/").addNamespace<ClientEvents>(
        "test-namespace",
      );
    };

    /** Resolves the rejection of `call`, narrowed to its payload type. */
    const rejectionOf = async <P extends { error: string }>(
      call: Promise<unknown>,
    ): Promise<SocketCallError<P> & P> => {
      try {
        await call;
      } catch (e) {
        if (e instanceof SocketCallError) return e as SocketCallError<P> & P;
        throw e;
      }
      throw new Error("expected the call to reject");
    };

    it("should reject an error payload as a SocketCallError", async () => {
      const namespace = withAckResponse({ error: "test error" });

      const thrown = await rejectionOf(namespace.failingEvent("arg1"));

      expect(thrown).toBeInstanceOf(SocketCallError);
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown.name).toBe("SocketCallError");
      expect(thrown.stack).toBeDefined();
    });

    it("should compose a message reporters can group on", async () => {
      const namespace = withAckResponse({ error: "test error" });

      const thrown = await rejectionOf(namespace.failingEvent("arg1"));

      expect(thrown.message).toBe("test-namespace/failingEvent: test error");
      expect(thrown.namespace).toBe("test-namespace");
      expect(thrown.event).toBe("failingEvent");
    });

    it("should prefer a ScopedError's own message", async () => {
      const namespace = withAckResponse({
        error: "invalid_username",
        message: "This username is already taken",
        selector: "#username",
      });

      const thrown = await rejectionOf<ScopedError<"invalid_username">>(
        namespace.failingEvent("arg1"),
      );

      expect(thrown.message).toBe("This username is already taken");
      expect(thrown.selector).toBe("#username");
    });

    it("should keep the payload readable by destructuring", async () => {
      const namespace = withAckResponse({
        error: "test error",
        errorDetails: "details",
      });

      const { error, errorDetails } = await rejectionOf<{
        error: "test error";
        errorDetails: string;
      }>(namespace.failingEvent("arg1"));

      expect(error).toBe("test error");
      expect(errorDetails).toBe("details");
    });

    it("should expose the untouched payload", async () => {
      const payload = { error: "test error", errorDetails: "details" };
      const namespace = withAckResponse(payload);

      const thrown = await rejectionOf(namespace.failingEvent("arg1"));

      expect(thrown.payload).toEqual(payload);
    });

    it("should not reject a successful response", async () => {
      const namespace = withAckResponse({ data: "ok" });

      await expect(namespace.testEvent("arg1")).resolves.toEqual({
        data: "ok",
      });
    });
  });

  describe("stringifyEventParameters", () => {
    it("should truncate long strings", () => {
      const longString = "a".repeat(60);
      const result = stringifyEventParameters([longString]);
      expect(result).toBe(JSON.stringify("a".repeat(50) + "..."));
    });

    it("should truncate long objects", () => {
      const input = {
        short: "value",
        long: "a".repeat(40),
        nested: {
          deeper: "b".repeat(40),
        },
      };
      const result = stringifyEventParameters([input]);
      expect(result).toBe(
        '{"short":"value","long":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","nested":{"deeper":"bbbbbbbbbbbbb...',
      );
    });

    it("should not truncate short strings", () => {
      const shortString = "hello";
      const result = stringifyEventParameters([shortString]);
      expect(result).toBe(JSON.stringify(shortString));
    });

    it("should handle arrays recursively", () => {
      const input = ["short", "a".repeat(60), ["nested", "b".repeat(60)]];
      const result = stringifyEventParameters([input]);
      expect(result).toBe(
        '["short","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...",["nested","bbbbbbbbbbbbbbbbbbbbbbbb...',
      );
    });

    it("should handle objects recursively", () => {
      const input = {
        short: "value",
        long: "a".repeat(60),
        nested: {
          deep: "b".repeat(60),
        },
      };
      const result = stringifyEventParameters([input]);
      expect(result).toBe(
        '{"short":"value","long":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...","nested":{"deep":"bb...',
      );
    });

    it("should preserve primitive types", () => {
      const input = {
        number: 42,
        boolean: true,
        null: null,
        string: "hello",
      };
      const result = stringifyEventParameters([input]);
      expect(result).toBe(JSON.stringify(input));
    });
  });
});
