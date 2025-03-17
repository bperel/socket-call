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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventsMap = Record<string, any>;

export type StringKeyOf<T> = keyof T & string;

type SpecialProperties = "_socket" | "_connect" | "_ongoingCalls";

type NamespaceProxyTargetInternal = {
  _socket: Socket | undefined;
  _connect: () => void;
  _ongoingCalls: Ref<string[]>;
};

type NamespaceProxyTarget<
  Events extends EventsMap,
  ServerSentEvents extends EventsMap = object,
> = Events & ServerSentEvents & NamespaceProxyTargetInternal;

type Context = { isOffline: boolean | undefined }

export abstract class SocketClientPlugin {
  abstract name: string;
  public abstract install(client: SocketClient): void;
  public abstract beforeEmit?<Events extends EventsMap>(
    namespaceName: string,
    eventName: StringKeyOf<Events>,
    args: any,
    context: Context,
  ): Promise<{ shouldContinue: boolean; result?: any }>;
  public abstract afterEmit?<Events extends EventsMap>(
    namespaceName: string,
    eventName: StringKeyOf<Events>,
    args: any,
    result: any,
    context: Context
  ): Promise<any>;
  public abstract onConnect?(namespaceName: string): void;
  public abstract onConnectError?(error: Error, namespaceName: string, eventName?: string): void;
  protected abstract configureNamespace?(namespaceName: string, options: any): void;
}

export class SocketClient {
  constructor(private socketRootUrl: string) {
  }

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
      plugins: SocketClientPlugin[];
    } = { plugins: [] },
  ): NamespaceProxyTarget<Events, ServerSentEvents> {
    const { session } = namespaceOptions;
    let socket: Socket | undefined;
    let isOffline: boolean | undefined;
    const ongoingCalls = ref<string[]>([]);

    const onConnectError = (
      e: Error,
      namespace: string
    ) => {
      console.error(`${namespace}: connect_error: ${e}`);
      for (const plugin of namespaceOptions.plugins) {
        plugin.onConnectError?.(e, namespaceName);
      }
    };

    const onConnected = (namespace: string) => {
      console.info(`${namespace}: connected`);
      for (const plugin of namespaceOptions.plugins) {
        plugin.onConnect?.(namespace);
      }
    };

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
          onConnectError(e, namespaceName);
        })
        .on("connect", () => {
          isOffline = false;
          console.log(
            `connected to ${namespaceName} at ${new Date().toISOString()}`);
          for (const plugin of namespaceOptions.plugins) {
            plugin.onConnect?.(namespaceName);
          }

          onConnected(namespaceName);
        });
    };

    type ProxyTarget = NamespaceProxyTarget<Events, ServerSentEvents>;

    return new Proxy({} as ProxyTarget, {
      set: <EventName extends StringKeyOf<ServerSentEvents>>(
        _: never,
        event: EventName,
        callback: ServerSentEvents[EventName],
      ) => {
        socket?.on(event, callback);
        return true;
      },
      get: <
        EventNameOrSpecialProperty extends
        | SpecialProperties
        | StringKeyOf<Events>,
      >(
        _: never,
        prop: EventNameOrSpecialProperty,
      ) => {
        switch (prop) {
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

        return async (
          ...args: Parameters<Events[EventNameOrSpecialProperty]>
        ) => {
          if (!socket) {
            connect();
          }
          const startTime = Date.now();
          const shortEventConsoleString = `${prop}(${JSON.stringify(
            args,
          ).replace(/[\[\]]/g, "")})` as const;
          const eventConsoleString = `${namespaceName}/${shortEventConsoleString}`;
          const debugCall = async (post: boolean = false) => {
            const token = await session?.getToken();
            if (prop !== "toJSON") {
              console.debug(
                `${eventConsoleString} ${post
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
          };

          const pluginContext = { isOffline };

          for (const plugin of namespaceOptions.plugins) {
            if (plugin.beforeEmit) {
              const { shouldContinue, result } = await plugin.beforeEmit(
                namespaceName,
                prop as StringKeyOf<Events>,
                args,
                pluginContext
              );

              if (!shouldContinue) {
                return result;
              }
            }
          }

          socket!.on("connect_error", (e) => {
            isOffline = true;

            onConnectError(
              e.message === "websocket error"
                ? {
                  message: "offline_no_cache",
                  name: "offline_no_cache",
                }
                : e,
              namespaceName
            );
          });

          await debugCall();
          const data = await socket!.emitWithAck(prop, ...args);

          if (data && typeof data === "object" && "error" in data) {
            throw data;
          }

          let processedData = data;
          for (const plugin of namespaceOptions.plugins) {
            if (plugin.afterEmit) {
              processedData = await plugin.afterEmit(
                namespaceName,
                prop as StringKeyOf<Events>,
                args,
                processedData,
                pluginContext
              );
            }
          }

          await debugCall(true);
          return processedData;
        };
      },
    });
  }
}
