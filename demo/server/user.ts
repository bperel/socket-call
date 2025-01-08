import type { Socket } from "socket.io";
import {
  ServerSentStartEndEvents,
  useSocketEvents,
} from "socket-call-server";
import namespaces from "./namespaces";

type SessionData = {
  user?: {
    username: string;
  };
};

type UserServerSentLongRunningEvents = {
  process: (processId: number) => void;
};

type UserServerSentEvents =
  ServerSentStartEndEvents<UserServerSentLongRunningEvents> & {
    reminder: (message: string) => void;
  };

const listenEvents = (socket: UserSocket) => ({
  login: async (username: string) => {
    socket.data.user = { username };
    return `You are now logged in ${username}!`;
  },
  sendReminderIn5Seconds: async () => {
    setTimeout(() => {
      socket.emit("reminder", `Hey ${socket.data.user!.username}, you asked me to remind you!`);
    }, 5000);
  },
  runProcess: async () => {
    const processId = ~~(Math.random()*1000)
    socket.emit("process", processId);
    setTimeout(() => {
      socket.emit("processEnd", processId);
    }, 2000);
  },
});

type UserSocket = Socket<typeof listenEvents, UserServerSentEvents, object, SessionData>;

const { client, server } = useSocketEvents<
  typeof listenEvents,
  UserServerSentEvents,
  Record<string, never>,
  SessionData
>(namespaces.USER, {
  listenEvents,
  middlewares: [],
});

export { client, server };
export type ClientEmitEvents = (typeof client)["emitEvents"];
export type ClientListenEvents = (typeof client)["listenEventsInterfaces"];
