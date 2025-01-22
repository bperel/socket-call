import type { Socket } from "socket.io";
import {
  NamespaceProxyTarget,
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
  showProgress: (processId: number) => void;
};

type UserServerSentEvents =
  ServerSentStartEndEvents<UserServerSentLongRunningEvents> & {
    showReminder: (message: string) => void;
  };

const listenEvents = (services: UserServices) => ({
  login: async (username: string) => {
    services._socket.data.user = { username };
    console.log(`User ${username} logged in`);
    return `You are now logged in ${username}!`;
  },
  sendReminderIn5Seconds: async () => {
    setTimeout(() => {
      services.showReminder(
        `Hey ${
          services._socket.data.user!.username
        }, you asked me to remind you!`
      );
    }, 5000);
  },
  runProcess: async () => {
    const processId = ~~(Math.random() * 1000);
    services.showProgress(processId);
    setTimeout(() => {
      services.showProgressEnd(processId);
    }, 2000);
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
>(namespaces.USER, {
  listenEvents,
  middlewares: [],
});

export { client, server };
export type ClientEmitEvents = (typeof client)["emitEvents"];
export type ClientListenEvents = (typeof client)["listenEventsInterfaces"];
