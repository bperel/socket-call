import * as v from "valibot";
import { VALIDATION_ERROR, formatIssues } from "./index.js";

/**
 * The messages a schema declares, as a union of literals.
 *
 * Valibot keeps them: `v.minLength(3, "…")` is typed
 * `MinLengthAction<string, 3, "…">`, so the literal survives in the schema's
 * type and can be read back out here.
 */
type MessagesOf<Schema> = Schema extends { pipe: readonly (infer Action)[] }
  ? Action extends { message: infer Message extends string }
    ? Message
    : never
  : never;

/**
 * What a rejected call answers with: a declared message when the action that
 * rejected carried one, `VALIDATION_ERROR` otherwise. Absent when there are no
 * schemas at all, so a no-argument event keeps its plain type.
 */
type RejectionOf<Input extends readonly v.GenericSchema[]> = [
  Input[number],
] extends [never]
  ? never
  : {
      error: MessagesOf<Input[number]> | typeof VALIDATION_ERROR;
      errorDetails?: string;
    };

/** The same messages {@link MessagesOf} reads, off the same pipe at runtime. */
const messagesOf = (schema: v.GenericSchema) =>
  "pipe" in schema
    ? (schema.pipe as readonly { message?: unknown }[])
        .map(({ message }) => message)
        .filter((message): message is string => typeof message === "string")
    : [];

/**
 * Declares a validated event in a single line. The schemas passed here are the
 * source of truth for both the runtime check and the event's TypeScript
 * signature: the handler's parameters are inferred from them, so nothing is
 * declared twice and the two cannot drift apart.
 *
 * A message given to a validation action is returned by the event, and appears
 * in its return type, so callers handle it as a value:
 *
 * ```typescript
 * const TOO_SHORT = "Username must be at least 3 characters long";
 *
 * const listenEvents = (services: UserServices) => ({
 *   login: ev(v.pipe(v.string(), v.minLength(3, TOO_SHORT)))(
 *     async (username) => {
 *       services._socket.data.user = { username };
 *       return `Welcome ${username}!`;
 *     },
 *   ),
 *   // (username: string) => Promise<string | { error: typeof TOO_SHORT }>
 *   ping: ev()(async () => "pong"),
 * });
 * ```
 *
 * Only the input is validated — the return type is inferred from the handler
 * body, which keeps the client-facing types intact without an output schema.
 *
 * A rejection is always returned, never thrown: with the declared message when
 * the action that rejected carried one, and with `VALIDATION_ERROR` plus
 * `errorDetails` otherwise — a type mismatch, an action given no message, or a
 * message nested inside an object schema. Either way the client rejects with a
 * `SocketCallError`, whose `error` the return type has already narrowed.
 */
export const ev = <const Input extends readonly v.GenericSchema[]>(
  ...input: Input
) => {
  const args = v.tuple(input);
  const declared = new Set(input.flatMap(messagesOf));

  return <Return>(
      handler: (...params: v.InferOutput<typeof args>) => Promise<Return>,
    ) =>
    async (
      ...received: v.InferInput<typeof args>
    ): Promise<Return | RejectionOf<Input>> => {
      const parsed = v.safeParse(args, received);
      if (parsed.success) {
        // Cast the handler rather than the arguments: spreading a tuple that is
        // still generic is not provably iterable to the compiler.
        return (handler as (...params: unknown[]) => Promise<Return>)(
          ...parsed.output,
        );
      }
      const declaredMessage = parsed.issues
        .map(({ message }) => message)
        .find((message) => declared.has(message));
      return (
        declaredMessage === undefined
          ? {
              error: VALIDATION_ERROR,
              errorDetails: formatIssues(parsed.issues),
            }
          : { error: declaredMessage }
      ) as RejectionOf<Input>;
    };
};
