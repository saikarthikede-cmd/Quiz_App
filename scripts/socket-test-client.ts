import { io } from "socket.io-client";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
const gameBaseUrl = process.env.GAME_BASE_URL ?? "http://localhost:4001";
const email = process.env.TEST_EMAIL;
const name = process.env.TEST_NAME ?? "Socket Test User";
const contestId = process.env.TEST_CONTEST_ID;
const answersRaw = process.env.TEST_ANSWERS ?? "";

if (!email || !contestId) {
  console.error("Missing TEST_EMAIL or TEST_CONTEST_ID.");
  process.exit(1);
}

const answers = answersRaw
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

async function loginAndGetToken() {
  const response = await fetch(`${apiBaseUrl}/auth/dev-login`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email,
      name
    })
  });

  if (!response.ok) {
    throw new Error(`Login failed with status ${response.status}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

async function main() {
  const token = await loginAndGetToken();
  const socket = io(gameBaseUrl, {
    transports: ["websocket"],
    auth: {
      token,
      contest_id: contestId
    }
  });

  socket.on("connect", () => {
    console.log(`Connected: ${socket.id}`);
  });

  socket.on("connect_error", (error) => {
    console.error("Connect error:", error.message);
  });

  socket.on("reconnected", (payload) => {
    console.log("reconnected", payload);
  });

  socket.on("lobby_update", (payload) => {
    console.log("lobby_update", payload);
  });

  socket.on("question", (payload: { seq: number }) => {
    console.log("question", payload);
    const answer = answers[payload.seq - 1];

    if (!answer) {
      console.log(`No scripted answer for question ${payload.seq}`);
      return;
    }

    setTimeout(() => {
      console.log(`submit_answer -> seq=${payload.seq}, option=${answer}`);
      socket.emit("submit_answer", {
        contest_id: contestId,
        question_seq: payload.seq,
        chosen_option: answer
      });
    }, 1000);
  });

  socket.on("answer_result", (payload) => {
    console.log("answer_result", payload);
  });

  socket.on("reveal", (payload) => {
    console.log("reveal", payload);
  });

  socket.on("contest_ended", (payload) => {
    console.log("contest_ended", JSON.stringify(payload, null, 2));
    socket.disconnect();
    process.exit(0);
  });

  socket.on("error", (payload) => {
    console.log("socket_error", payload);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
