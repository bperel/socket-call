// @ts-ignore Optional peer dependency
import type { CacheOptions } from "axios-cache-interceptor";
import { io, type Socket } from "socket.io-client";
import { Ref, ref } from "vue";

export type ScopedError<ErrorKey extends string = string> = {
  error: ErrorKey;
  message: string;
  selector: string;
};

export type Errorable<T, ErrorKey extends string> =
  | T
  | { error: ErrorKey; errorDetails?: string }
  | ScopedError<ErrorKey>;

export type WithoutError<T> = T extends { error: any; errorDetails?: any }
  ? never
  : T extends { error: any }
    ? never
    : T;

export type EventOutput<
  ClientEvents extends EventsMap,
  EventName extends keyof ClientEvents,
> = Awaited<ReturnType<ClientEvents[EventName]>>;

export type SuccessfulEventOutput<
  ClientEvents extends EventsMap,
  EventName extends keyof ClientEvents,
> = WithoutError<EventOutput<ClientEvents, EventName>>;

type SocketCacheOptions<Events extends EventsMap> = Pick<
  CacheOptions,
  "storage"
> & {
  ttl: number | ((event: StringKeyOf<Events>, args: unknown[]) => number);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventsMap = Record<string, (...args: any[]) => Promise<any>>;

type StringKeyOf<T> = keyof T & string;

type SpecialProperties = "_socket" | "_connect" | "_ongoingCalls";

type NamespaceProxyTargetInternal = {
  _socket: Socket | undefined;
  _connect: () => void;
  _ongoingCalls: Ref<string[]>;
};

type AddDisableCache<T> = T extends (...args: infer Args) => infer Return
  ? (...args: [...Args, { disableCache: boolean }] | Args) => Return
  : never;

type NamespaceProxyTarget<
  Events extends EventsMap,
  ServerSentEvents extends Record<string, (...args: any[]) => void> = Record<
    string,
    never
  >,
> = {
  [K in keyof Events]: AddDisableCache<Events[K]>;
} & ServerSentEvents &
  NamespaceProxyTargetInternal;

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const formatValue = (obj: JsonValue): JsonValue => {
  if (typeof obj === "string") {
    return obj.length > 50 ? `${obj.slice(0, 50)}...` : obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(formatValue);
  }
  if (obj && typeof obj === "object" && !Buffer.isBuffer(obj)) {
    return Object.entries(obj).reduce<{ [key: string]: JsonValue }>(
      (result, [key, value]) => ({
        ...result,
        [key]: formatValue(value),
      }),
      {},
    );
  }
  return obj;
};

export const stringifyEventParameters = (args: JsonValue[]): string => {
  let stringified = args
    .map((arg) => JSON.stringify(formatValue(arg)))
    .join(", ");
  if (stringified.length > 100) {
    stringified = stringified.substring(0, 100) + "...";
  }
  return stringified;
};

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
      this.cacheHydrator.state = ref({
        mode: "LOAD_CACHE",
        cachedCallsDone: [],
        hydratedCallsDoneAmount: 0,
      });

      console.debug("loading cache...");
      await loadCachedDataFn();

      this.cacheHydrator.state.value!.mode = "HYDRATE";
      this.cacheHydrator.state.value!.hydratedCallsDoneAmount = 0;

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
    ServerSentEvents extends Record<string, (...args: any[]) => void> = Record<
      string,
      never
    >,
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
  ): NamespaceProxyTarget<Events, ServerSentEvents> {
    const { session, cache } = namespaceOptions;
    let socket: Socket | undefined;

    let isOffline: boolean | undefined;

    const ongoingCalls = ref<string[]>([]);

    const connect = () => {
      console.log("connect");
      console.log(
        `connecting to ${namespaceName} at ${new Date().toISOString()}`,
      );
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

    type ProxyTarget = NamespaceProxyTarget<Events, ServerSentEvents>;

    return new Proxy({} as ProxyTarget, {
      set: <EventName extends StringKeyOf<ServerSentEvents>>(
        _: never,
        event: EventName,
        callback: ServerSentEvents[EventName],
      ) => {
        socket?.on(event, callback as any);
        return true;
      },
      get: <
        EventNameOrSpecialProperty extends
          | SpecialProperties
          | StringKeyOf<Events>,
      >(
        _: never,
        eventName: EventNameOrSpecialProperty,
      ) => {
        switch (eventName) {
          case "_socket":
            return socket as ProxyTarget["_socket"];
          case "_connect":
            return connect as ProxyTarget["_connect"];
          case "_ongoingCalls":
            return ongoingCalls as ProxyTarget["_ongoingCalls"];
          case "__proto__":
          case "toJSON":
            return null as any;
        }

        type EventParameters = Parameters<Events[EventNameOrSpecialProperty]>;

        return async (
          ...args:
            | [...EventParameters, { disableCache: true }]
            | EventParameters
        ) => {
          if (!socket) {
            connect();
          }
          const startTime = Date.now();

          const lastArg = [...args].pop();
          const disableCache =
            lastArg &&
            typeof lastArg === "object" &&
            "disableCache" in lastArg &&
            lastArg.disableCache;
          if (disableCache) {
            args.pop();
          }

          const shortEventConsoleString =
            `${eventName}(${stringifyEventParameters(args)})` as const;
          const eventConsoleString = `${namespaceName}/${shortEventConsoleString}`;
          const debugCall = async (post: boolean = false, cached = false) => {
            const token = await session?.getToken();
            if (eventName !== "toJSON") {
              if (cached) {
                console.debug(`${eventConsoleString} served from cache`);
              } else {
                console.debug(
                  `${eventConsoleString} ${
                    post
                      ? `responded in ${Date.now() - startTime}ms`
                      : `called ${token ? "with token" : "without token"}`
                  } at ${new Date().toISOString()}`,
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
          let isCacheUsed = false;
          let cacheKey;
          if (cache && !disableCache) {
            cacheKey = `${namespaceName}/${eventName} ${JSON.stringify(args)}`;
            const cacheData = await cache.storage.get(cacheKey, {
              cache: {
                ttl:
                  isOffline ||
                  this.cacheHydrator.state.value?.mode === "LOAD_CACHE"
                    ? undefined
                    : typeof cache.ttl === "function"
                      ? cache.ttl(eventName, args)
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
                      this.cacheHydrator.state.value.hydratedCallsDoneAmount++;
                    }
                    break;
                }
              }
              return cacheData as any;
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
              eventName,
            );
          });

          await debugCall();
          const data = await socket!.emitWithAck(eventName, ...args);

          if (data && typeof data === "object" && "error" in data) {
            throw data;
          }
          await debugCall(true);
          if (cache && cacheKey) {
            cache.storage.set(cacheKey, data, {
              timeout:
                typeof cache.ttl === "function"
                  ? cache.ttl(eventName, args)
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
        };
      },
    });
  }
}

export type { AxiosStorage } from "axios-cache-interceptor";
export { buildStorage, buildWebStorage } from "axios-cache-interceptor";
