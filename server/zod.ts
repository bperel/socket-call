import { z } from "zod";

/**
 * Declares a validated event in a single line. The schemas passed here are the
 * source of truth for both the runtime check and the event's TypeScript
 * signature: the handler's parameters are inferred from them, so nothing is
 * declared twice and the two cannot drift apart.
 *
 * ```typescript
 * const listenEvents = (services: UserServices) => ({
 *   login: ev(z.string().min(3), z.number().int())(async (username, age) => {
 *     services._socket.data.user = { username };
 *     return `Welcome ${username}!`;
 *   }),
 *   ping: ev()(async () => "pong"),
 * });
 * ```
 *
 * Only the input is validated — the return type is inferred from the handler
 * body, which keeps the client-facing types intact without an `output` schema.
 * Reach for `z.function({ input, output })` directly if you also want the
 * response checked at runtime.
 *
 * Invalid input makes the handler throw, which the dispatcher turns into a
 * `VALIDATION_ERROR` ack; the client then rejects with a `SocketCallError`.
 */
export const ev = <Input extends z.core.$ZodType[]>(...input: Input) => {
  const schema = z.function({ input });
  return schema.implementAsync.bind(schema) as typeof schema.implementAsync;
};
