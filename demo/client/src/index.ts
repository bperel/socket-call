import { EventOutput, SocketClient } from "socket-call-client";
import namespaces from "../../server/namespaces.ts";
import {
  type ClientListenEvents as UserListenEvents,
  type ClientEmitEvents as UserEmitEvents,
} from "../../server/user.ts";

const socket = new SocketClient("http://localhost:3000");
const user = socket.addNamespace<UserEmitEvents, UserListenEvents>(
  namespaces.USER
);

const log = (message: string) => {
  document.getElementById("messages")!.innerHTML += `${message}<br />`;
};

document.getElementById("login-form")!.addEventListener("submit", (e) => {
  e.preventDefault();
  const username = document.getElementById("username") as HTMLInputElement;
  user.login(username.value).then((message) => {
    //^login: (username: string) => Promise<string>

    // We can use the EventOutput type to get the return type of the event
    type Message = EventOutput<UserEmitEvents, "login">;
    const myMessage: Message = message;
    log(myMessage);
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
  //                      ^ message: string
  log(message);
};

user.showProgress = (id) => {
  //                 ^ id: number
  log(`Process started: ${id}`);
};

user.showProgressEnd = (id) => {
  log(`Process ended: ${id}`);
};
