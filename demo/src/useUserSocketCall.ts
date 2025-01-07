import namespaces from '../server/namespaces.ts';
import { ClientListenEvents, type ClientEmitEvents as UserEmitEvents } from '../server/user.ts';
import { SocketClient } from 'socket-call-client';

export const useUserSocketCall = () => {
  const socket = new SocketClient('http://localhost:3000');
  return {
    options: {},
    user: socket.addNamespace<UserEmitEvents, ClientListenEvents>(namespaces.USER),
  };
};
