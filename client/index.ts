// @ts-ignore Optional peer dependency
import type { CacheOptions } from "axios-cache-interceptor";
import { io, type Socket } from "socket.io-client";
import { Ref, ref } from "vue";

// Copied from socket.io-client
type DisconnectDescription =
  | Error
  | {
      description: string;
      context?: unknown;
    };

// Copied from socket.io-component-emitter
type FallbackToUntypedListener<T> = [T] extends [never]
  ? (...args: unknown[]) => void | Promise<void>
  : T;

// Copied from socket.io-client
type SocketReservedEvents = {
  connect: () => void;
  connect_error: (err: Error) => void;
  disconnect: (
    reason: Socket.DisconnectReason,
    description?: DisconnectDescription,
  ) => void;
};

type SocketCacheOptions<Events extends EventsMap> = Pick<
  CacheOptions,
  "storage"
> & {
  ttl: number | ((event: StringKeyOf<Events>, args: unknown[]) => number);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventsMap = Record<string, any>;

type StringKeyOf<T> = keyof T & string;

export type ServerSideEventCalls<S extends EventsMap> = S;

export class SocketClient {
  constructor(private socketRootUrl: string) {}

  public cacheHydrator = {
    state: ref<{
      mode: "LOAD_CACHE" | "HYDRATE";
      cachedCallsDone: string[];
      hydratedCallsDoneAmount: number;
    }>(),
    run: async (
      loadCachedDataFn: () => Promise<void>,
      loadRealDataFn: () => void,
    ) => {
      this.cacheHydrator.state.value = {
        mode: "LOAD_CACHE",
        cachedCallsDone: [],
        hydratedCallsDoneAmount: 0,
      };

      console.debug("loading cache...");
      await loadCachedDataFn();

      this.cacheHydrator.state.value.mode = "HYDRATE";
      this.cacheHydrator.state.value.hydratedCallsDoneAmount = 0;

      console.debug("Hydrating...");
      loadRealDataFn();
    },
  };

  public onConnectError = (
    e: Error,
    namespace: string,
    _eventName?: string,
  ) => {
    console.error(`${namespace}: connect_error: ${e}`);
  };
  public onConnected = (namespace: string) => {
    console.info(`${namespace}: connected`);
  };

  public addNamespace<
    Events extends EventsMap,
    ServerSentEvents extends EventsMap = object,
  >(
    namespaceName: string,
    namespaceOptions: {
      onConnectError?: (e: Error, namespace: string) => void;
      onConnected?: (namespace: string) => void;

      session?: {
        getToken: () => Promise<string | null | undefined>;
        clearSession: () => Promise<void> | void;
        sessionExists: () => Promise<boolean>;
      };
      cache?: Required<SocketCacheOptions<Events>> & {
        disableCache?: (eventName: StringKeyOf<Events>) => boolean;
      };
    } = {},
  ): {
    socket: Socket | undefined;
    connect: () => void;
    ongoingCalls: Ref<string[]>;
    on: <E extends StringKeyOf<ServerSentEvents>>(
      event: E,
      callback: (...data: Parameters<ServerSentEvents[E]>) => void
    ) => void;
    events: Events;
  } {
    const { session, cache } = namespaceOptions;
    let socket: Socket | undefined;

    let isOffline: boolean | undefined;

    const ongoingCalls = ref<string[]>([]);

    const connect = () => {
      socket = io(this.socketRootUrl + namespaceName, {
        extraHeaders: {
          "X-Namespace": namespaceName,
        },
        timeout: 1000,
        transports: ["websocket"],
        multiplex: false,
        auth: async (cb) => {
          const token = await session?.getToken();
          cb(token ? { token } : {});
        },
      })
        .onAny((event, ...args) => {
          if (!["connect", "connect_error"].includes(event)) {
            console.debug(`${namespaceName}/${event} received`, args);
          }
        })
        .on("connect_error", (e) => {
          isOffline = true;
          console.log("connect_error", namespaceName, e);
          this.onConnectError(e, namespaceName);
        })
        .on("connect", () => {
          isOffline = false;
          console.log(
            `connected to ${namespaceName} at ${new Date().toISOString()}`,
          );

          this.onConnected(namespaceName);
        });
    };

    return {
      socket,
      connect,
      ongoingCalls,
      on: <E extends StringKeyOf<ServerSentEvents>>(
        event: E,
        callback: (...data: Parameters<ServerSentEvents[E]>) => void,
      ): void => {
        socket?.on(
          event,
          callback as FallbackToUntypedListener<
            E extends "connect" | "connect_error" | "disconnect"
              ? SocketReservedEvents[E]
              : E extends string
                ? (...args: unknown[]) => void
                : never
          >,
        );
      },
      events: new Proxy({} as Events, {
        get:
          <EventName extends StringKeyOf<Events>>(
            _: never,
            event: EventName,
          ) =>
          async (
            ...args: Parameters<Events[EventName]>
          ): Promise<Awaited<ReturnType<Events[EventName]> | undefined>> => {
            let isCacheUsed = false;
            if (!socket) {
              console.log(
                `connecting to ${namespaceName} at ${new Date().toISOString()}`,
              );
              connect();
            }
            const startTime = Date.now();
            const shortEventConsoleString =
              `${event}(${JSON.stringify(args).replace(/[\[\]]/g, "")})` as const;
            const eventConsoleString = `${namespaceName}/${shortEventConsoleString}`;
            const debugCall = async (post: boolean = false, cached = false) => {
              const token = await session?.getToken();
              if (event !== "toJSON") {
                if (cached) {
                  console.debug(`${eventConsoleString} served from cache`);
                } else {
                  console.debug(
                    `${eventConsoleString} ${post ? `responded in ${Date.now() - startTime}ms` : `called ${token ? "with token" : "without token"}`} at ${new Date().toISOString()}`,
                  );

                  if (post) {
                    ongoingCalls.value = ongoingCalls.value.filter(
                      (call) => call !== shortEventConsoleString,
                    );
                  } else {
                    ongoingCalls.value = ongoingCalls.value.concat(
                      shortEventConsoleString,
                    );
                  }
                }
              }
            };
            let cacheKey;
            if (cache) {
              cacheKey = `${namespaceName}/${event} ${JSON.stringify(args)}`;
              const cacheData = await cache.storage.get(cacheKey, {
                cache: {
                  ttl:
                    isOffline ||
                    this.cacheHydrator.state.value?.mode === "LOAD_CACHE"
                      ? undefined
                      : typeof cache.ttl === "function"
                        ? cache.ttl(event, args)
                        : cache.ttl,
                },
              });
              isCacheUsed =
                cacheData !== undefined &&
                !(typeof cacheData === "object" && cacheData.state === "empty");
              if (isCacheUsed) {
                debugCall(true, true);
                if (this.cacheHydrator.state.value) {
                  switch (this.cacheHydrator.state.value.mode) {
                    case "LOAD_CACHE":
                      this.cacheHydrator.state.value.cachedCallsDone.push(
                        eventConsoleString,
                      );
                      break;
                    case "HYDRATE":
                      if (
                        this.cacheHydrator.state.value.cachedCallsDone.includes(
                          eventConsoleString,
                        )
                      ) {
                        this.cacheHydrator.state.value
                          .hydratedCallsDoneAmount++;
                      }
                      break;
                  }
                }
                return cacheData as Awaited<ReturnType<Socket["emitWithAck"]>>;
              }
            }

            socket!.on("connect_error", (e) => {
              isOffline = true;

              this.onConnectError(
                e.message === "websocket error"
                  ? {
                      message: "offline_no_cache",
                      name: "offline_no_cache",
                    }
                  : e,
                namespaceName,
                event,
              );
            });

            await debugCall();
            const data = await socket!.emitWithAck(event, ...args);

            if (data && typeof data === "object" && "error" in data) {
              throw data;
            }
            await debugCall(true);
            if (cache && cacheKey) {
              cache.storage.set(cacheKey, data, {
                timeout:
                  typeof cache.ttl === "function"
                    ? cache.ttl(event, args)
                    : cache.ttl,
              });
            }
            if (
              this.cacheHydrator.state.value?.mode === "HYDRATE" &&
              this.cacheHydrator.state.value.cachedCallsDone.includes(
                eventConsoleString,
              )
            ) {
              this.cacheHydrator.state.value.hydratedCallsDoneAmount++;
            }
            return data;
          },
      }),
    };
  }}

export type { AxiosStorage } from "axios-cache-interceptor";
export { buildStorage, buildWebStorage } from "axios-cache-interceptor";
