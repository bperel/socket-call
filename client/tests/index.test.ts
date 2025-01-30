import { NotEmptyStorageValue } from "axios-cache-interceptor";
import { AxiosStorage, SocketClient } from "../index";
import { expect, describe, mock, beforeEach, it, jest } from "bun:test";

const mockSocket = {
  io: jest.fn(() => ({
    connect: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
    onAny: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    emitWithAck: jest.fn().mockResolvedValue({ data: "test" }),
  })),
};

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
      const namespace = socketClient.addNamespace("test-namespace");

      expect(namespace).toBeDefined();
      expect(namespace._socket).toBeUndefined();
      expect(typeof namespace._connect).toBe("function");
    });

    it("should handle connection with session token", () => {
      const mockToken = "test-token";
      const namespace = socketClient.addNamespace("test-namespace", {
        session: {
          getToken: jest.fn().mockResolvedValue(mockToken),
          clearSession: jest.fn(),
          sessionExists: jest.fn().mockResolvedValue(true),
        },
      });

      namespace._connect();

      expect(mockSocket.io).toHaveBeenCalledWith(
        "http://test.com/test-namespace",
        expect.objectContaining({
          extraHeaders: { "X-Namespace": "test-namespace" },
          transports: ["websocket"],
        })
      );
    });

    it("should handle an event call", async () => {
      const namespace = socketClient.addNamespace("test-namespace");
      await namespace.testEvent("arg1");

      expect(namespace._socket!.emitWithAck).toHaveBeenCalledWith(
        "testEvent",
        "arg1"
      );
    });

    it("should store and restore cached responses", async () => {
      let cachedValue: Record<string, NotEmptyStorageValue> = {
        'test-namespace/testEvent ["arg2"]': {
          data: { data: "cached", headers: {}, status: 200, statusText: "OK" },
          createdAt: 1,
          state: "cached",
          ttl: 1,
        },
      };
      const storage: AxiosStorage = {
        set: (key, data) => {
          cachedValue[key] = data;
        },
        get: async (key) => cachedValue[key],
        remove: () => jest.fn(),
        clear: () => jest.fn(),
      };
      const namespace = socketClient.addNamespace("test-namespace", {
        cache: {
          ttl: 1,
          storage,
        },
      });
      const cachedResponse = await namespace.testEvent("arg2");
      expect(cachedResponse.data.data).toEqual("cached");

      const response = await namespace.testEvent("arg1");
      expect(response).toEqual({ data: "test" });
    });

    it("should keep the state of the data loader", async () => {
      let cachedValue: Record<string, NotEmptyStorageValue> = {
        'test-namespace/testEvent ["arg2"]': {
          data: { data: "cached", headers: {}, status: 200, statusText: "OK" },
          createdAt: 1,
          state: "cached",
          ttl: 1,
        },
      };
      const storage: AxiosStorage = {
        set: (key, data) => {
          cachedValue[key] = data;
        },
        get: async (key) => cachedValue[key],
        remove: () => jest.fn(),
        clear: () => jest.fn(),
      };
      const namespace = socketClient.addNamespace("test-namespace", {
        cache: {
          ttl: 1,
          storage,
        },
      });

      await socketClient.cacheHydrator.run(
        () =>
          namespace.testEvent("arg2").then(() => {
            expect(
              JSON.parse(
                JSON.stringify(
                  socketClient.cacheHydrator.state.value?.cachedCallsDone
                )
              )
            ).toEqual(['test-namespace/testEvent("arg2")']);
          }),
        () => {
          expect(
            socketClient.cacheHydrator.state.value?.cachedCallsDone
          ).toEqual([]);
        }
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
        expect.stringContaining("test-namespace: connect_error")
      );
    });

    // it('should handle socket errors in namespace', async () => {
    //   const namespace = socketClient.addNamespace('test-namespace');
    //   const error = { error: 'test error' };

    //   namespace._connect()

    //   mockSocket.io.emitWithAck.mockResolvedValueOnce(error);

    //   await expect(namespace.testEvent()).rejects.toEqual(error);
    // });
  });
});
