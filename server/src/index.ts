import express, {
  type ErrorRequestHandler,
} from "express";
import { createServer } from "node:http";
import { STATIC_DIR, PORT } from "./config.js";
import { commands, subscriber } from "./redis.js";
import routes from "./routes.js";
import { attachRealtime } from "./realtime.js";

const app = express();
// Trust the single Kubernetes ingress hop so IP rate limits use the client address.
app.set("trust proxy", 1);
app.use(express.json());
app.use("/api", routes);
if (STATIC_DIR) app.use(express.static(STATIC_DIR));

const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  console.error("Request failed:", error);
  response.status(500).json({ error: "Internal server error" });
};
app.use(handleError);

const server = createServer(app);
attachRealtime(server);

await Promise.all([commands.ping(), subscriber.ping()]);
server.listen(PORT, () => {
  console.log(`Grid server listening on port ${PORT}`);
});
