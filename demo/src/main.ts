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
  user.events.login(username.value).then((message) => {
    log(message);
  });
});

document.getElementById("send-reminder")!.addEventListener("click", () => {
  user.events.sendReminderIn5Seconds();
});

document.getElementById("run-process")!.addEventListener("click", () => {
  user.events.runProcess();
});

user.connect();

user.on.reminder = (message) => {
  log(message);
}

user.on.process = (id) => {
  log(`Process started: ${id}<br />`);
};

user.on.processEnd = (id) => {
  log(`Process ended: ${id}<br />`);
};
