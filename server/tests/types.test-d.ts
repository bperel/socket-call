import type { Socket } from "socket.io";
import { z } from "zod";
import { type NamespaceProxyTarget, useSocketEvents } from "../index";
import { ev } from "../zod";

type UserServerSentEvents = { showReminder: (message: string) => void };
type SessionData = { user?: { username: string } };

const listenEvents = (services: UserServices) => ({
  // schemas are the single source of truth for the signature
  login: ev(
    z.string().min(3),
    z.number().int(),
  )(async (username, age) => {
    services._socket.data.user = { username };
    return { greeting: `Welcome ${username}`, age };
  }),
  ping: ev()(async () => "pong"),
  // unvalidated handlers keep working unchanged
  plain: async (n: number) => n * 2,
});

type UserServices = NamespaceProxyTarget<
  Socket<typeof listenEvents, UserServerSentEvents, object, SessionData>,
  UserServerSentEvents
>;

const { client } = useSocketEvents<typeof listenEvents, UserServerSentEvents>(
  "/user",
  { listenEvents, middlewares: [] },
);

type ClientEmitEvents = (typeof client)["emitEvents"];

// 1. the client-facing type is the plain function type, parameter names kept
const login: ClientEmitEvents["login"] = async (
  username: string,
  age: number,
) => ({
  greeting: username,
  age,
});
void login;

// 2. arguments are typed from the schemas
type LoginArgs = Parameters<ClientEmitEvents["login"]>;
const args: LoginArgs = ["bruno", 38];
// @ts-expect-error the second argument is a number
const badArgs: LoginArgs = ["bruno", "38"];
// @ts-expect-error both arguments are required
const missingArgs: LoginArgs = ["bruno"];
void [args, badArgs, missingArgs];

// 3. the return type is inferred from the handler body, no output schema needed
type LoginReturn = Awaited<ReturnType<ClientEmitEvents["login"]>>;
const ok: LoginReturn = { greeting: "hi", age: 1 };
// @ts-expect-error `greeting` is a string
const bad: LoginReturn = { greeting: 1, age: 1 };
void [ok, bad];

// 4. no-argument and unvalidated events resolve as expected
const pong: Awaited<ReturnType<ClientEmitEvents["ping"]>> = "pong";
const doubled: Awaited<ReturnType<ClientEmitEvents["plain"]>> = 42;
void [pong, doubled];

// 5. a handler whose parameters contradict the schemas is rejected
// @ts-expect-error schema says string, handler annotates number
void ev(z.string())(async (n: number) => n);
// @ts-expect-error one schema cannot cover a two-parameter handler
void ev(z.string())(async (a: string, b: string) => a + b);
