import { useUserSocketCall } from './useUserSocketCall';

const { user } = useUserSocketCall();

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
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

document.getElementById('login-form')!.addEventListener('submit', (e) => {
  e.preventDefault();
  const username = document.getElementById('username') as HTMLInputElement;
  user.events.login(username.value).then((res) => {
    document.getElementById('messages')!.innerHTML += res + '<br />';
  })
});

document.getElementById('send-reminder')!.addEventListener('click', () => {
  user.events.sendReminderIn5Seconds();
});

document.getElementById('run-process')!.addEventListener('click', () => {
  user.events.runProcess();
});

user.connect()

user.on('reminder', (message) => {
  document.getElementById('messages')!.innerHTML += message + '<br />';
});

user.on('process', (id) => {
  document.getElementById('messages')!.innerHTML += 'Process started: ' +
   id + '<br />';
});

user.on('processEnd', (id) => {
  document.getElementById('messages')!.innerHTML += 'Process ended: ' +
   id + '<br />';
});