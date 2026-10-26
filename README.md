### socket-call

This small library on top of socket.io allows to call events like any regular async Typescript function.

[Code Sandbox demo here!](https://codesandbox.io/p/github/bperel/socket-call/main)

Usage example:

- Server side:

```typescript
import { Server } from "socket.io";
import {
  type NamespaceProxyTarget,
  type ServerSentStartEndEvents,
  useSocketEvents,
} from "socket-call-server";

const io = new Server();
user(io);
io.listen(3000);

type SessionData = {
  user?: {
    username: string;
  };
};

type UserServerSentEvents = {
  showServerMessage: (message: string) => void;
};

const listenEvents = (services: UserServices) => ({
  // Add your events here, the name of the event is the name of the function
  login: async (username: string) => {
    services._socket.data.user = { username };
    console.log(`User ${username} logged in`);
    setInterval(() => {
      // Calling an event that's handled client-side
      services.showServerMessage(`You're still logged in ${username}!`);
    }, 1000);
    return `You are now logged in ${username}!`;
  },
});

type UserServices = NamespaceProxyTarget<
  Socket<typeof listenEvents, UserServerSentEvents, object, SessionData>,
  UserServerSentEvents
>;

const { client, server } = useSocketEvents<
  typeof listenEvents,
  UserServerSentEvents,
  Record<string, never>,
  SessionData
>("/user", {
  listenEvents,
  middlewares: [],
});

export type ClientEmitEvents = (typeof client)["emitEvents"];
export type ClientListenEvents = (typeof client)["listenEventsInterfaces"];
```

#### Runtime validation

Event arguments arrive from the network, so their declared types are a promise
rather than a guarantee. Wrap a handler in `ev` to check them at runtime with
[Valibot](https://valibot.dev):

```typescript
import * as v from "valibot";
import { ev } from "socket-call-server/valibot";

const listenEvents = (services: UserServices) => ({
  // `username` needs no annotation: its type is inferred from the schema
  login: ev(v.pipe(v.string(), v.minLength(3)))(async (username) => {
    services._socket.data.user = { username };
    return `You are now logged in ${username}!`;
  }),

  // events without arguments, and plain unvalidated events, work as before
  logout: ev()(async () => "Bye!"),
  double: async (n: number) => n * 2,
});
```

One schema per positional argument. The schemas are the single source of truth:
the handler's parameters are inferred from them, so nothing is written twice and
a handler whose parameters contradict its schemas is a compile error.

A trailing schema that accepts `undefined` — `v.optional(...)`, `v.nullish(...)`
— makes the argument omissible rather than merely nullable, so callers can leave
it out instead of passing an explicit `undefined`:

```typescript
createEntry: ev(
  v.number(),
  v.optional(v.number()),
)(async (position, parentId) => createEntry(position, parentId));
// (position: number, parentId?: number) => Promise<…>
// client: createEntry(3) and createEntry(3, 7) both typecheck
```

Only trailing arguments are omissible: an optional schema followed by a required
one is still a slot the caller has to fill. A default (`v.optional(v.number(),
0)`) leaves the argument optional for the caller while the handler receives a
number, with no narrowing check to write.

Only the input is validated — the return type is inferred from the handler body,
which keeps the client-facing types intact without an output schema.

When validation fails the handler is never called and the client's promise
rejects with a `SocketCallError` carrying `error: "VALIDATION_ERROR"` and an
`errorDetails` string listing the offending arguments. Any other error thrown by
a handler rejects with `error: "INTERNAL_ERROR"`, with the original error logged
server-side and kept out of the payload. Pass `onEventError` to
`useSocketEvents` to report these somewhere other than the console.

Give a validation action a message and the event returns it rather than
throwing, with the message in its return type:

```typescript
const TOO_SHORT = "Username must be at least 3 characters long";
const TOO_LONG = "Username must be at most 20 characters long";

login: ev(
  v.pipe(v.string(), v.minLength(3, TOO_SHORT), v.maxLength(20, TOO_LONG)),
)(async (username) => `You are now logged in ${username}!`);
// (username: string) => Promise<
//   | string
//   | { error: typeof TOO_SHORT | typeof TOO_LONG | "VALIDATION_ERROR";
//       errorDetails?: string }
// >
```

A rejection with no declared message answers `VALIDATION_ERROR` with the same
`errorDetails`, so the union above is the complete set of errors an event can
answer with, and the client's `SocketCallError` narrows `error` to it. Messages
form a flat union across arguments.

`valibot` is an optional peer dependency: it is only needed if you import
`socket-call-server/valibot`.

- Client side:

```typescript
import { SocketClient } from "socket-call-client";
import {
  type ClientListenEvents as UserListenEvents,
  type ClientEmitEvents as UserEmitEvents,
} from "../server/user.ts";

const socket = new SocketClient("http://localhost:3000");
const user = socket.addNamespace<UserEmitEvents, UserListenEvents>("/user");

// Calling an event that's declared server-side
user.login(username.value).then((message) => {
  console.log("Server acked with", message);
});

// Handling an event that is sent by the server
user.showServerMessage = (message) => {
  console.log("Server sent us the message", message);
};
```

#### Caching

Event responses can be cached per namespace. A cache needs a `storage` and a
`ttl`, and then applies to every event of that namespace:

```typescript
import { SocketClient } from "socket-call-client";
import { createStorage } from "unstorage";
import localStorageDriver from "unstorage/drivers/localstorage";

const socket = new SocketClient("http://localhost:3000");
const user = socket.addNamespace<UserEmitEvents, UserListenEvents>("/user", {
  cache: {
    storage: createStorage({
      driver: localStorageDriver({ base: "socket-call" }),
    }),
    ttl: 5 * 60 * 1000,
    staleTtl: 24 * 60 * 60 * 1000,
  },
});
```

Entries are keyed by namespace, event name and arguments, so `user.getProfile(1)`
and `user.getProfile(2)` are cached separately.

`ttl` is how long a response is served from the cache instead of reaching the
server. `staleTtl` extends that window, but the extension only applies while the
connection is down or while `cacheHydrator` is priming the cache: an entry past
its `ttl` is always refetched when the server is reachable. It is what lets an
offline client keep working on data it already has. Leave `staleTtl` unset and
expired entries are simply dropped.

Both accept a function instead of a number when the duration depends on the
event:

```typescript
const ttl = (event: string) => (event === "getProfile" ? 60_000 : 5_000);
```

Pass `{ disableCache: true }` as an extra last argument to bypass the cache for a
single call — the argument is stripped before the event is sent:

```typescript
await user.getProfile(1, { disableCache: true });
```

A storage is anything implementing `SocketCacheStorage` (`getItem`, `setItem`
and `removeItem`); the client itself decides whether an entry is fresh, stale or
expired. Any [unstorage](https://unstorage.unjs.io) instance fits as-is, which
covers memory, `localStorage`, IndexedDB, Redis and more. Other libraries only
need a thin adapter:

```typescript
import type { SocketCacheStorage } from "socket-call-client";
import { get, set, del } from "idb-keyval";

const storage: SocketCacheStorage = {
  getItem: (key) => get(key),
  setItem: (key, entry) => set(key, entry),
  removeItem: (key) => del(key),
};
```

A failed cache write (a full `localStorage`, for instance) is logged and does
not fail the call.

#### Observing client state

`user._ongoingCalls` (the calls of a namespace that are waiting for an answer)
and `socket.cacheHydrator.state` are framework-agnostic stores: read the current
value with `.value`, or `subscribe` to be called with it now and on every
change. Values are replaced rather than mutated, so they plug into any UI
library:

```typescript
// Vue
const ongoingCalls = shallowRef(user._ongoingCalls.value);
onScopeDispose(
  user._ongoingCalls.subscribe((calls) => (ongoingCalls.value = calls)),
);

// React
const ongoingCalls = useSyncExternalStore(
  user._ongoingCalls.subscribe,
  () => user._ongoingCalls.value,
);

// Svelte: stores are used as-is
const ongoingCalls = user._ongoingCalls; // then `$ongoingCalls` in markup
```
