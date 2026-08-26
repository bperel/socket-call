import {
  SocketClient, SocketCallError,
  type Errorable, type EventError, type SuccessfulEventOutput,
} from "../index";

type AuthEvents = {
  changePassword: (p: { token: string; password: string }) => Promise<
    Errorable<{ jwt: string }, "Invalid token" | "Password too short">
  >;
};

const auth = new SocketClient("wss://x").addNamespace<AuthEvents>("/auth");

// 1. resolved value has no error branch
auth.changePassword({ token: "t", password: "p" }).then((r) => {
  const jwt: string = r.jwt;
  return jwt;
});

// 2. .catch() keeps the literal union; exhaustive switch proven by `never`
auth.changePassword({ token: "t", password: "p" }).catch((e) => {
  switch (e.error) {
    case "Invalid token": return 1;
    case "Password too short": return 2;
  }
  const exhaustive: never = e.error;
  return exhaustive;
});

// 3. a typo in a case label is rejected
auth.changePassword({ token: "t", password: "p" }).catch((e) => {
  // @ts-expect-error "Nope" is not part of the error union
  if (e.error === "Nope") return 1;
  return 0;
});

// 4. ScopedError members are reachable by narrowing
auth.changePassword({ token: "t", password: "p" }).catch((e) => {
  if ("selector" in e) {
    const sel: string = e.selector;
    return sel;
  }
  return "";
});

// 5. it really is an Error instance
auth.changePassword({ token: "t", password: "p" }).catch((e) => {
  const isErr: boolean = e instanceof SocketCallError && e instanceof Error;
  return isErr;
});

// 5. Error-ness: message and stack exist for Sentry
auth.changePassword({ token: "t", password: "p" }).catch((e) => {
  const m: string = e.message;
  const s: string | undefined = e.stack;
  return [m, s];
});

// 6. destructuring the payload still works (backward compat)
auth.changePassword({ token: "t", password: "p" }).catch(({ error }) => error);

// 7. exported helpers still resolve
type Ok = SuccessfulEventOutput<AuthEvents, "changePassword">;
type Err = EventError<AuthEvents, "changePassword">;
const _ok: Ok = { jwt: "x" };
const _err: Err = { error: "Invalid token" };
void [_ok, _err];

// 8. await inside try/catch: binding is `unknown` (documented TS limitation)
async function viaTryCatch() {
  try {
    await auth.changePassword({ token: "t", password: "p" });
  } catch (e) {
    // @ts-expect-error catch clause variables cannot be typed
    const bad: { error: string } = e;
    return bad;
  }
}
void viaTryCatch;
