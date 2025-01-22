import { Server } from "socket.io";
import { server as user } from "./user";

const io = new Server({
  cors: {
    origin: "*",
  },
});

user(io);

io.listen(3000);
console.log("Server listening on port 3000");
