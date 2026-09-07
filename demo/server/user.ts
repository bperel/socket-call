import type { Socket } from "socket.io";
import * as v from "valibot";
import {
  type NamespaceProxyTarget,
  type ServerSentStartEndEvents,
  useSocketEvents,
} from "socket-call-server";
import { ev } from "socket-call-server/valibot";
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

const TOO_SHORT = "Username must be at least 3 characters long";
const TOO_LONG = "Username must be at most 20 characters long";
const NO_PASSWORD = "Password must not be empty";

const listenEvents = (services: UserServices) => {
  console.log("User namespace connected");
  return {
    // These two events are equivalent: same signature, same typed errors.
    login: ev(
      v.pipe(v.string(), v.minLength(3, TOO_SHORT), v.maxLength(20, TOO_LONG)),
      v.pipe(v.string(), v.nonEmpty(NO_PASSWORD)),
    )(async (username, password) => {
      services._socket.data.user = { username };
      console.log(
        `User ${username} logged in with a ${password.length}-character password`,
      );
      return `You are now logged in ${username}!`;
    }),
    otherLogin: async (username: string, password: string) => {
      if (username.length < 3) {
        return { error: TOO_SHORT } as const;
      }
      if (username.length > 20) {
        return { error: TOO_LONG } as const;
      }
      if (password.length === 0) {
        return { error: NO_PASSWORD } as const;
      }
      services._socket.data.user = { username };
      console.log(
        `User ${username} logged in with a ${password.length}-character password`,
      );
      return `You are now logged in ${username}!`;
    },
    sendReminderIn5Seconds: async () => {
      setTimeout(() => {
        services.showReminder(
          `Hey ${services._socket.data.user!.username}, you asked me to remind you!`,
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
  };
};

type UserServices = NamespaceProxyTarget<
  Socket<typeof listenEvents, UserServerSentEvents, object, SessionData>,
  UserServerSentEvents
>;

const { client, server } = useSocketEvents<
  typeof listenEvents,
  UserServerSentEvents
>(namespaces.USER, {
  listenEvents,
  middlewares: [],
});

export { client, server };
export type ClientEmitEvents = (typeof client)["emitEvents"];
export type ClientListenEvents = (typeof client)["listenEventsInterfaces"];
