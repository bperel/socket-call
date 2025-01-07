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
    typeof useSocketServices
  >["client"]["emitEvents"],
  EventName extends keyof ClientEvents,
> = Awaited<ReturnType<ClientEvents[EventName]>>;

export type SuccessfulEventOutput<
  ClientEvents extends ReturnType<
    typeof useSocketServices
  >["client"]["emitEvents"],
  EventName extends keyof ClientEvents,
> = WithoutError<EventOutput<ClientEvents, EventName>>;

type ServerSentEndEvents<Events extends { [event: string]: any }> = {
  [K in keyof Events & string as `${K}End`]: Events[K];
};

export type ServerSentStartEndEvents<Events extends { [event: string]: any }> =
  Events & ServerSentEndEvents<Events>;

export const useSocketServices = <
  ListenEvents extends (
    socket: Socket<
      ReturnType<ListenEvents>,
      EmitEvents,
      ServerSideEvents,
      SocketData
    >,
  ) => AsyncEventsMap,
  EmitEvents extends EventsMap = EventsMap,
  ServerSideEvents extends EventsMap = EventsMap,
  SocketData extends object = object,
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
  },
) => ({
  server: (io: Server) => {
    const namespace = io.of(endpoint);
    for (const middleware of options?.middlewares ?? []) {
      namespace.use(middleware);
    }

    namespace.on("connection", (socket) => {
      if (options.listenEvents) {
        const socketEventImplementations = options.listenEvents(socket);
        for (const eventName in socketEventImplementations) {
          socket.on(eventName, async (...args: unknown[]) => {
            const callback = args.pop() as Function;
            const output = await socketEventImplementations[eventName](...args);
            callback(output);
          });
        }
      }
    });
  },
  client: {
    emitEvents: {} as unknown as ReturnType<ListenEvents>,
    listenEventsInterfaces: {} as unknown as EmitEvents,
  },
});
