import type { Namespace, Server, Socket } from "socket.io";

type AsyncEventsMap = {
  [event: string]: (...args: any[]) => Promise<any>;
};
type EventsMap = {
  [event: string]: (...args: any[]) => any;
};

export type ScopedError<ErrorKey extends string = string> = {
  error: ErrorKey;
  message: string;
  selector: string;
};

export type EitherOr<A, B> = A | B extends object
  ?
      | (A & Partial<Record<Exclude<keyof B, keyof A>, never>>)
      | (B & Partial<Record<Exclude<keyof A, keyof B>, never>>)
  : A | B;

export type Errorable<T, ErrorKey extends string> = EitherOr<
  T,
  EitherOr<{ error: ErrorKey; errorDetails?: string }, ScopedError<ErrorKey>>
>;

export type WithoutError<T> = T extends { error: any; errorDetails?: any }
  ? never
  : T extends { error: any }
  ? never
  : T;

export type EventOutput<
  ClientEvents extends ReturnType<
    typeof useSocketEvents
  >["client"]["emitEvents"],
  EventName extends keyof ClientEvents
> = Awaited<ReturnType<ClientEvents[EventName]>>;

export type SuccessfulEventOutput<
  ClientEvents extends ReturnType<
    typeof useSocketEvents
  >["client"]["emitEvents"],
  EventName extends keyof ClientEvents
> = WithoutError<EventOutput<ClientEvents, EventName>>;

type ServerSentEndEvents<Events extends { [event: string]: any }> = {
  [K in keyof Events & string as `${K}End`]: Events[K];
};

type NamespaceProxyTargetInternal<Socket> = {
  _socket: Socket;
};

export type NamespaceProxyTarget<
  Socket,
  EmitEvents extends EventsMap
> = EmitEvents & NamespaceProxyTargetInternal<Socket>;

const getProxy = <S extends Socket, EmitEvents extends EventsMap>(socket: S) =>
  new Proxy({} as NamespaceProxyTarget<S, EmitEvents>, {
    get: <
      EventNameOrSpecialProperty extends "_socket" | (keyof EmitEvents & string)
    >(
      target: NamespaceProxyTarget<S, EmitEvents>,
      prop: EventNameOrSpecialProperty
    ): EventNameOrSpecialProperty extends "_socket"
      ? typeof socket
      : (
          ...args: Parameters<EmitEvents[EventNameOrSpecialProperty]>
        ) => boolean => {
      if (prop === "_socket") {
        return socket as any; // TODO improve typing
      }
      return ((...args: any[]) => socket.emit(prop, ...args)) as any; // TODO improve typing
    },
  });

export type ServerSentStartEndEvents<Events extends { [event: string]: any }> =
  Events & ServerSentEndEvents<Events>;

export const useSocketEvents = <
  ListenEvents extends (
    services: NamespaceProxyTarget<Socket, EmitEvents>
  ) => AsyncEventsMap,
  EmitEvents extends EventsMap = EventsMap,
  ServerSideEvents extends EventsMap = EventsMap,
  SocketData extends object = object
>(
  endpoint: Parameters<Server["of"]>[0],
  options: {
    listenEvents: ListenEvents;
    middlewares: Parameters<
      Namespace<
        ReturnType<ListenEvents>,
        EmitEvents,
        ServerSideEvents,
        SocketData
      >["use"]
    >[0][];
  }
) => ({
  server: (io: Server) => {
    const namespace = io.of(endpoint);
    for (const middleware of options?.middlewares ?? []) {
      namespace.use(middleware);
    }

    namespace.on("connection", (socket) => {
      const socketEventImplementations = options.listenEvents(
        getProxy<typeof socket, EmitEvents>(socket)
      );
      for (const eventName in socketEventImplementations) {
        socket.on(eventName, async (...args: unknown[]) => {
          const callback = args.pop() as Function;
          const output = await socketEventImplementations[eventName](...args);
          callback(output);
        });
      }
    });
  },
  client: {
    emitEvents: {} as unknown as ReturnType<ListenEvents>,
    listenEventsInterfaces: {} as unknown as EmitEvents,
  },
});
