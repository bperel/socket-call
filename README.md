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
[Zod](https://zod.dev):

```typescript
import { z } from "zod";
import { ev } from "socket-call-server/zod";

const listenEvents = (services: UserServices) => ({
  // `username` needs no annotation: its type is inferred from the schema
  login: ev(z.string().min(3))(async (username) => {
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

Only the input is validated — the return type is inferred from the handler body,
which keeps the client-facing types intact without an `output` schema. Use
`z.function({ input, output })` directly if you want the response checked too.

When validation fails the handler is never called and the client's promise
rejects with a `SocketCallError` carrying `error: "VALIDATION_ERROR"` and an
`errorDetails` string listing the offending arguments. Any other error thrown by
a handler rejects with `error: "INTERNAL_ERROR"`, with the original error logged
server-side and kept out of the payload. Pass `onEventError` to
`useSocketEvents` to report these somewhere other than the console.

`zod` is an optional peer dependency: it is only needed if you import
`socket-call-server/zod`.

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
