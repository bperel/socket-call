import type { ExtendedError, Server, Socket } from "socket.io";

export type ScopedError<ErrorKey extends string = string> = {
  error: ErrorKey;
  message: string;
  selector: string;
};

export type Errorable<T, ErrorKey extends string> =
  T | { error: ErrorKey; errorDetails?: string } | ScopedError<ErrorKey>;

type AsyncEventsMap = {
  [event: string]: (...args: any[]) => Promise<any>;
};
type EventsMap = {
  [event: string]: (...args: any[]) => any;
};

type ServerSentEndEvents<Events extends { [event: string]: any }> = {
  [K in keyof Events & string as `${K}End`]: Events[K];
};

type NamespaceProxyTargetInternal<Socket> = {
  _socket: Socket;
};

export type NamespaceProxyTarget<
  Socket,
  EmitEvents extends EventsMap,
> = EmitEvents & NamespaceProxyTargetInternal<Socket>;

const getProxy = <S extends Socket, EmitEvents extends EventsMap>(socket: S) =>
  new Proxy({} as NamespaceProxyTarget<S, EmitEvents>, {
    get: <
      EventNameOrSpecialProperty extends
        "_socket" | (keyof EmitEvents & string),
    >(
      _: never,
      prop: EventNameOrSpecialProperty,
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

export type EmitTarget = {
  emit: (event: string, ...args: any[]) => unknown;
};

/**
 * Build a typed proxy that emits server-sent events through any
 * {@link EmitTarget}, without needing a live client connection. Use it to emit
 * from HTTP handlers, background workers, or any code that has an `io`/emitter
 * but no per-socket `services` object.
 *
 * Pass an optional `socket` to also expose it as `_socket` on the returned
 * proxy — useful when handlers reused across a socket path and an out-of-band
 * path (e.g. an HTTP upload) read state from `_socket.data`. When provided, the
 * return type gains `_socket` via {@link NamespaceProxyTarget}.
 */
export const getServerSentEvents = <EmitEvents extends EventsMap, S = never>(
  target: EmitTarget,
  socket?: S,
): [S] extends [never] ? EmitEvents : NamespaceProxyTarget<S, EmitEvents> =>
  new Proxy({} as EmitEvents, {
    get: <EventName extends keyof EmitEvents & string>(
      _: never,
      prop: EventName | "_socket",
    ) =>
      socket !== undefined && prop === "_socket"
        ? socket
        : (...args: Parameters<EmitEvents[EventName]>) =>
            target.emit(prop, ...args),
  }) as [S] extends [never] ? EmitEvents : NamespaceProxyTarget<S, EmitEvents>;

export const useSocketEvents = <
  ListenEvents extends (
    services: NamespaceProxyTarget<Socket, EmitEvents>,
  ) => AsyncEventsMap,
  EmitEvents extends EventsMap = EventsMap,
>(
  endpoint: Parameters<Server["of"]>[0],
  options: {
    listenEvents: ListenEvents;
    middlewares: ((
      services: NamespaceProxyTarget<Socket, EmitEvents>,
      next: (err?: ExtendedError) => void,
    ) => void)[];
  },
) => ({
  server: (io: Server) => {
    const namespace = io.of(endpoint);
    for (const middleware of options?.middlewares ?? []) {
      namespace.use((socket, next) => {
        middleware(getProxy<typeof socket, EmitEvents>(socket), next);
      });
    }

    namespace.on("connection", (socket) => {
      const socketEventImplementations = options.listenEvents(
        getProxy<typeof socket, EmitEvents>(socket),
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
    emitEvents: {} as ReturnType<ListenEvents>,
    listenEventsInterfaces: {} as EmitEvents,
  },
});
