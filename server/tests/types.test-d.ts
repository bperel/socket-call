import type { Socket } from "socket.io";
import * as v from "valibot";
import {
  type NamespaceProxyTarget,
  useSocketEvents,
  VALIDATION_ERROR,
} from "../index";
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

/**
 * The same event written by hand. It matches `validated` except for
 * `VALIDATION_ERROR`, which only the schema can report: a hand-written guard
 * takes its parameter's type on trust.
 */
const byHand = async (username: string) => {
  if (username.length < 3) {
    return { error: "Username must be at least 3 characters long" as const };
  }
  if (username.length > 20) {
    return { error: "Username must be at most 20 characters long" as const };
  }
  return `Welcome ${username}`;
};

// the hand-written errors are all accounted for by the validated event
const fromHand: typeof validated = byHand;
void fromHand;

type ValidatedReturn = Awaited<ReturnType<typeof validated>>;
const short: ValidatedReturn = { error: TOO_SHORT };
const long: ValidatedReturn = { error: TOO_LONG };
// a rejection no message covers is reported as VALIDATION_ERROR
const fallback: ValidatedReturn = {
  error: VALIDATION_ERROR,
  errorDetails: "0: Invalid type: Expected string but received 42",
};
// @ts-expect-error only declared messages, plus VALIDATION_ERROR, are in the union
const undeclared: ValidatedReturn = { error: "something else" };
void [short, long, fallback, undeclared];

// 7. an action given no message leaves VALIDATION_ERROR as the only rejection
const unnamed = ev(v.pipe(v.string(), v.minLength(3)))(async (u) => u);
type UnnamedReturn = Awaited<ReturnType<typeof unnamed>>;
const justTheValue: UnnamedReturn = "bruno";
const onlyFallback: UnnamedReturn = { error: VALIDATION_ERROR };
// @ts-expect-error no message was declared, so no literal joins the union
const noSuchError: UnnamedReturn = { error: TOO_SHORT };
void [justTheValue, onlyFallback, noSuchError];

// 7b. with no schemas at all there is nothing to reject, so no error member
const noSchemas = ev()(async () => "pong");
type NoSchemasReturn = Awaited<ReturnType<typeof noSchemas>>;
const pongOnly: NoSchemasReturn = "pong";
// @ts-expect-error a no-argument event cannot fail validation
const impossible: NoSchemasReturn = { error: VALIDATION_ERROR };
void [pongOnly, impossible];

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
const nestedFallback: NestedReturn = { error: VALIDATION_ERROR };
// @ts-expect-error only messages on an argument's own pipe are declared
const nestedError: NestedReturn = { error: "BAD" };
void [plainString, nestedFallback, nestedError];

// 10. a trailing argument whose schema accepts `undefined` can be omitted
const withOptional = ev(
  v.number(),
  v.optional(v.number()),
)(async (position, parentId) => `${position}:${parentId}`);
type OptionalParams = Parameters<typeof withOptional>;
const omitted: OptionalParams = [3];
const explicit: OptionalParams = [3, undefined];
const given: OptionalParams = [3, 4];
// @ts-expect-error the schema still types the argument when it is given
const wrongType: OptionalParams = [3, "4"];
void [omitted, explicit, given, wrongType];

// only the trailing arguments are omissible, and the optional ones stop at the
// first schema that is not
const leadingOptional = ev(
  v.optional(v.number()),
  v.number(),
)(async (parentId, position) => `${position}:${parentId}`);
type LeadingParams = Parameters<typeof leadingOptional>;
const bothGiven: LeadingParams = [undefined, 3];
// @ts-expect-error an optional schema before a required one is still a slot
const oneGiven: LeadingParams = [3];
void [bothGiven, oneGiven];

// several trailing optional arguments are omissible one by one
const twoOptional = ev(
  v.number(),
  v.optional(v.number()),
  v.optional(v.string()),
)(async (a, b, c) => `${a}${b}${c}`);
type TwoOptionalParams = Parameters<typeof twoOptional>;
const first: TwoOptionalParams = [1];
const second: TwoOptionalParams = [1, 2];
const third: TwoOptionalParams = [1, 2, "c"];
void [first, second, third];

// every argument optional
const allOptional = ev(
  v.optional(v.number()),
  v.optional(v.string()),
)(async (a, b) => `${a}${b}`);
type AllParams = Parameters<typeof allOptional>;
const none: AllParams = [];
const one: AllParams = [1];
const both: AllParams = [1, "b"];
void [none, one, both];

// an optional before a required one is still a slot, trailing ones still drop
const interleaved = ev(
  v.optional(v.number()),
  v.string(),
  v.optional(v.boolean()),
  v.optional(v.number()),
)(async (a, b, c, d) => `${a}${b}${c}${d}`);
type InterleavedParams = Parameters<typeof interleaved>;
const filled: InterleavedParams = [undefined, "b"];
const three: InterleavedParams = [1, "b", true];
const four: InterleavedParams = [1, "b", true, 2];
// @ts-expect-error the leading optional cannot be dropped
const dropped: InterleavedParams = ["b"];
void [filled, three, four, dropped];

// a default in the middle of the optional tail: omissible for the caller,
// certain for the handler
const mixedDefaults = ev(
  v.number(),
  v.optional(v.number()),
  v.optional(v.string(), "x"),
)(async (a, b, c) => {
  const certain: string = c;
  const maybe: number | undefined = b;
  return `${a}${maybe}${certain}`;
});
type MixedParams = Parameters<typeof mixedDefaults>;
const justFirst: MixedParams = [1];
const twoOf: MixedParams = [1, 2];
void [justFirst, twoOf];

// nullish counts as accepting undefined
const nullish = ev(
  v.number(),
  v.nullish(v.string()),
)(async (a, b) => `${a}${b}`);
const nullishOmitted: Parameters<typeof nullish> = [1];
const nullishNull: Parameters<typeof nullish> = [1, null];
void [nullishOmitted, nullishNull];

// a default makes the argument optional to the caller and certain for the
// handler, which reads it without a narrowing check
const withDefault = ev(
  v.number(),
  v.optional(v.number(), 0),
)(async (position, parentId) => position + parentId);
type DefaultParams = Parameters<typeof withDefault>;
const noDefault: DefaultParams = [3];
void noDefault;

// the handler's own parameters follow the same rule
void ev(
  v.number(),
  v.optional(v.number()),
)(async (position: number, parentId?: number) => `${position}:${parentId}`);
void ev(
  v.number(),
  v.optional(v.number()),
)(
  // @ts-expect-error the argument is absent, not of another type
  async (position, parentId: string) => `${position}:${parentId}`,
);
