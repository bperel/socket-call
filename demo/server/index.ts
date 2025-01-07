import { Server } from "socket.io";
import { server as user } from "./user";
import { createServer } from "http";

const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

user(io);

httpServer.listen(3000);
console.log("Server listening on port 3000");
