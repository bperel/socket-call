import { SocketClient } from 'socket-call-client';
import namespaces from "../server/namespaces.ts";
import {
  ClientListenEvents,
  type ClientEmitEvents as UserEmitEvents,
} from "../server/user.ts";

const socket = new SocketClient("http://localhost:3000");
const user = socket.addNamespace<UserEmitEvents, ClientListenEvents>(
  namespaces.USER
);

const log = (message: string) => {
  document.getElementById("messages")!.innerHTML += `${message}<br />`;
};

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
  <h4>socket-call</h4>
  <form id="login-form">
  <input id="username" type="text" placeholder="username" />
  <input type="submit" value="Login" />
  </form>
  <div><button id="send-reminder">Send me a reminder in 5 seconds</button></div>
  <div><button id="run-process">Run a server process</button></div>
  <br />
  <div id="messages"></div>
  </div>
`;

document.getElementById("login-form")!.addEventListener("submit", (e) => {
  e.preventDefault();
  const username = document.getElementById("username") as HTMLInputElement;
  user.login(username.value).then((message) => {
    log(message);
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
  log(message);
}

user.showProgress = (id) => {
  log(`Process started: ${id}`);
};

user.showProgressEnd = (id) => {
  log(`Process ended: ${id}`);
};
