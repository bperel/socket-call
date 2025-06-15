[Code Sandbox demo here!](https://codesandbox.io/p/github/bperel/socket-call/main)

Usage example:
* Server side:

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
      services.showServerMessage(`You're still logged in ${username}!`)
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
>('/user', {
  listenEvents,
  middlewares: [],
});

export type ClientEmitEvents = (typeof client)["emitEvents"];
export type ClientListenEvents = (typeof client)["listenEventsInterfaces"];
```

* Client side:

```typescript
import { SocketClient } from 'socket-call-client';
import {
  type ClientListenEvents as UserListenEvents,
  type ClientEmitEvents as UserEmitEvents,
} from "../server/user.ts";

const socket = new SocketClient("http://localhost:3000");
const user = socket.addNamespace<UserEmitEvents, UserListenEvents>(
  '/user'
);

// Calling an event that's declared server-side
user.login(username.value).then((message) => {
  console.log('Server acked with', message);
});

// Handling an event that is sent by the server
user.showServerMessage = (message) => {
  console.log('Server sent us the message', message);
}
```
