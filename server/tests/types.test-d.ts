import type { Socket } from "socket.io";
import * as v from "valibot";
import { type NamespaceProxyTarget, useSocketEvents } from "../index";
import { ev } from "../valibot";

type UserServerSentEvents = { showReminder: (message: string) => void };
type SessionData = { user?: { username: string } };

const listenEvents = (services: UserServices) => ({
  // schemas are the single source of truth for the signature
  login: ev(
    v.pipe(v.string(), v.minLength(3)),
    v.pipe(v.number(), v.integer()),
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
void ev(v.string())(async (n: number) => n);
// @ts-expect-error one schema cannot cover a two-parameter handler
void ev(v.string())(async (a: string, b: string) => a + b);

// 6. a message given to an action lands in the event's return type
const TOO_SHORT = "Username must be at least 3 characters long";
const TOO_LONG = "Username must be at most 20 characters long";

const validated = ev(
  v.pipe(v.string(), v.minLength(3, TOO_SHORT), v.maxLength(20, TOO_LONG)),
)(async (username) => `Welcome ${username}`);

/** The same event written by hand, which `validated` has to match. */
const byHand = async (username: string) => {
  if (username.length < 3) {
    return { error: "Username must be at least 3 characters long" as const };
  }
  if (username.length > 20) {
    return { error: "Username must be at most 20 characters long" as const };
  }
  return `Welcome ${username}`;
};

// mutual assignability: the two spellings are the same type
const fromHand: typeof validated = byHand;
const fromEv: typeof byHand = validated;
void [fromHand, fromEv];

type ValidatedReturn = Awaited<ReturnType<typeof validated>>;
const short: ValidatedReturn = { error: TOO_SHORT };
const long: ValidatedReturn = { error: TOO_LONG };
// @ts-expect-error only declared messages are part of the union
const undeclared: ValidatedReturn = { error: "something else" };
void [short, long, undeclared];

// 7. an action given no message contributes nothing to the return type
const unnamed = ev(v.pipe(v.string(), v.minLength(3)))(async (u) => u);
type UnnamedReturn = Awaited<ReturnType<typeof unnamed>>;
const justTheValue: UnnamedReturn = "bruno";
// @ts-expect-error nothing declared a message, so there is no error member
const noSuchError: UnnamedReturn = { error: TOO_SHORT };
void [justTheValue, noSuchError];

// 8. messages from several arguments are unioned, parameters still inferred
const twoArgs = ev(
  v.pipe(v.string(), v.minLength(3, TOO_SHORT)),
  v.pipe(v.number(), v.integer("Age must be whole")),
)(async (username, age) => `${username}:${age}`);
type TwoReturn = Awaited<ReturnType<typeof twoArgs>>;
const firstMessage: TwoReturn = { error: TOO_SHORT };
const secondMessage: TwoReturn = { error: "Age must be whole" };
void [firstMessage, secondMessage];
type TwoParams = Parameters<typeof twoArgs>;
const goodArgs: TwoParams = ["bruno", 38];
// @ts-expect-error the schemas still drive the parameter types
const wrongArgs: TwoParams = ["bruno", "38"];
void [goodArgs, wrongArgs];

// 9. a message nested inside an object schema is not collected
const nested = ev(v.object({ email: v.pipe(v.string(), v.email("BAD")) }))(
  async ({ email }) => email,
);
type NestedReturn = Awaited<ReturnType<typeof nested>>;
const plainString: NestedReturn = "a@b.c";
// @ts-expect-error only messages on an argument's own pipe are declared
const nestedError: NestedReturn = { error: "BAD" };
void [plainString, nestedError];
