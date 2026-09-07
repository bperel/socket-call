import type { ExtendedError, Server, Socket } from "socket.io";

/** `error` sent to the client when a handler's input or output fails validation. */
export const VALIDATION_ERROR = "VALIDATION_ERROR";
/** `error` sent to the client when a handler throws for any other reason. */
export const INTERNAL_ERROR = "INTERNAL_ERROR";

export type EventErrorPayload = {
  error: typeof VALIDATION_ERROR | typeof INTERNAL_ERROR;
  errorDetails?: string;
};

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

type Issue = { message: string; path?: readonly unknown[] };

/**
 * Structural test for a validation failure, duck-typed on the `issues` array
 * that every Standard Schema library throws. Keeps socket-call free of any
 * dependency on Zod, Valibot or the like.
 */
const isValidationError = (e: unknown): e is { issues: Issue[] } =>
  typeof e === "object" &&
  e !== null &&
  Array.isArray((e as { issues?: unknown }).issues);

/** Standard Schema allows both bare keys and `{ key }` wrappers in a path. */
const formatPathSegment = (segment: unknown) =>
  typeof segment === "object" && segment !== null && "key" in segment
    ? String((segment as { key: unknown }).key)
    : String(segment);

const formatIssues = (issues: Issue[]) =>
  issues
    .map(({ path, message }) =>
      path?.length
        ? `${path.map(formatPathSegment).join(".")}: ${message}`
        : message,
    )
    .join("; ");

/**
 * Handler failures never reach the client verbatim: a validation error is
 * reported with its issues, anything else stays opaque so that internal
 * messages are not leaked.
 */
const toErrorPayload = (e: unknown): EventErrorPayload =>
  isValidationError(e)
    ? { error: VALIDATION_ERROR, errorDetails: formatIssues(e.issues) }
    : { error: INTERNAL_ERROR };

export const useSocketEvents = <
  ListenEvents extends (
    services: NamespaceProxyTarget<Socket, EmitEvents>,
  ) => AsyncEventsMap,
  EmitEvents extends EventsMap = EventsMap,
>(
  endpoint: Parameters<Server["of"]>[0],
  options: {
    listenEvents: ListenEvents;
    /** Called for every handler failure, before the error payload is acked. */
    onEventError?: (eventName: string, error: unknown) => void;
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
          // Only pop an actual ack callback: socket.io omits it when the
          // client emits without expecting a reply.
          const callback =
            typeof args.at(-1) === "function"
              ? (args.pop() as (output: unknown) => void)
              : undefined;
          try {
            // Awaited on its own line: `callback?.(await …)` would short-circuit
            // the whole expression when there is no ack callback, never running
            // the handler at all.
            const output = await socketEventImplementations[eventName](...args);
            callback?.(output);
          } catch (e) {
            // Letting this reject would surface as an unhandled rejection
            // (fatal on Node) and leave the caller's promise pending forever.
            if (options.onEventError) {
              options.onEventError(eventName, e);
            } else {
              console.error(`${String(endpoint)}/${eventName} threw`, e);
            }
            callback?.(toErrorPayload(e));
          }
        });
      }
    });
  },
  client: {
    emitEvents: {} as ReturnType<ListenEvents>,
    listenEventsInterfaces: {} as EmitEvents,
  },
});
