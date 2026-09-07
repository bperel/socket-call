import {
  EventError,
  SocketClient,
  SuccessfulEventOutput,
} from "socket-call-client";
import namespaces from "../../server/namespaces.ts";
import {
  type ClientListenEvents as UserListenEvents,
  type ClientEmitEvents as UserEmitEvents,
} from "../../server/user.ts";

const socket = new SocketClient("http://localhost:3000");
const user = socket.addNamespace<UserEmitEvents, UserListenEvents>(
  namespaces.USER,
);

const log = (message: string) => {
  document.getElementById("messages")!.innerHTML += `${message}<br />`;
};

document.getElementById("login-form")!.addEventListener("submit", (e) => {
  e.preventDefault();
  const username = document.getElementById("username") as HTMLInputElement;
  const password = document.getElementById("password") as HTMLInputElement;
  user
    .login(username.value, password.value)
    .then((message /* typed as string */) => {
      // We can use the SuccessfulEventOutput type to get its resolved type
      type Message = SuccessfulEventOutput<UserEmitEvents, "login">;
      const myMessage: Message = message;
      log(myMessage);
    })
    .catch((error) => {
      // And the EventError type to get the errors it can reject with
      type LoginError = EventError<UserEmitEvents, "login">["error"];
      const reason: LoginError = error.error;
      log(`Error: ${reason}`);
    });
});

document.getElementById("send-reminder")!.addEventListener("click", () => {
  user.sendReminderIn5Seconds();
});

document.getElementById("run-process")!.addEventListener("click", () => {
  user.runProcess();
});

user._connect();

user.showReminder = (message) => {
  //                 ^ message: string
  log(message);
};

user.showProgress = (id) => {
  //                 ^ id: number
  log(`Process started: ${id}`);
};

user.showProgressEnd = (id) => {
  log(`Process ended: ${id}`);
};
