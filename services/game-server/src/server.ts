import { createServer } from "node:http";

import { pool } from "@quiz-app/db";
import {
  contestAnsweredKey,
  contestChannel,
  contestQuestionKey,
  contestRoom,
  contestScoresKey,
  contestStateKey,
  createRedisClient,
  runRedisWithRetry
} from "@quiz-app/redis";
import { createAdapter } from "@socket.io/redis-adapter";
import { jwtVerify } from "jose";
import { Server } from "socket.io";
import { z } from "zod";

const gamePort = Number(process.env.GAME_PORT ?? 4001);
const jwtSecret = new TextEncoder().encode(process.env.JWT_SECRET ?? "replace_me");
const jwtIssuer = process.env.JWT_ISSUER ?? "quiz-app";
const jwtAudience = process.env.JWT_AUDIENCE ?? "quiz-app-users";

function parseCsv(...values: Array<string | undefined>) {
  return values
    .flatMap((value) => (value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

const frontendUrls = new Set(
  parseCsv(
    process.env.FRONTEND_URL,
    process.env.FRONTEND_URLS,
    "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001"
  )
);

function isAllowedDevOrigin(origin: string) {
  try {
    const url = new URL(origin);
    const isLocalHost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.startsWith("10.") ||
      url.hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(url.hostname);

    return isLocalHost && /^300[0-5]$/.test(url.port);
  } catch {
    return false;
  }
}

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (frontendUrls.has(origin)) {
        callback(null, true);
        return;
      }

      if (process.env.NODE_ENV !== "production" && isAllowedDevOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by Socket.io CORS`), false);
    },
    credentials: true
  }
});

const commandRedis = createRedisClient("game-server");
const adapterPub = createRedisClient("game-server-adapter-pub");
const adapterSub = createRedisClient("game-server-adapter-sub");
const eventSubscriber = createRedisClient("game-server-events");

const submitAnswerSchema = z.object({
  contest_id: z.uuid(),
  question_seq: z.number().int().positive(),
  chosen_option: z.enum(["a", "b", "c", "d"])
});

type SocketUser = {
  id: string;
  tenantId: string;
  contestId: string;
};

async function verifyToken(token: string) {
  const { payload } = await jwtVerify(token, jwtSecret, {
    issuer: jwtIssuer,
    audience: jwtAudience
  });

  return {
    userId: String(payload.user_id),
    tenantId: String(payload.tenant_id),
    isBanned: Boolean(payload.is_banned)
  };
}

async function checkContestAccess(contestId: string, tenantId: string) {
  const result = await pool.query(
    "SELECT 1 FROM contests WHERE id = $1 AND tenant_id = $2 LIMIT 1",
    [contestId, tenantId]
  );

  return (result.rowCount ?? 0) > 0;
}

async function checkContestMembership(contestId: string, userId: string, tenantId: string) {
  try {
    const isMember = await runRedisWithRetry(() =>
      commandRedis.sismember(`contest:${contestId}:members`, userId)
    );
    return isMember === 1;
  } catch {
    const result = await pool.query(
      `
        SELECT 1
        FROM contest_members cm
        JOIN contests c ON c.id = cm.contest_id
        WHERE cm.contest_id = $1
          AND cm.user_id = $2
          AND c.tenant_id = $3
        LIMIT 1
      `,
      [contestId, userId, tenantId]
    );
    return (result.rowCount ?? 0) > 0;
  }
}

async function getContestState(contestId: string, tenantId: string) {
  try {
    const state = await runRedisWithRetry(() => commandRedis.hgetall(contestStateKey(contestId)));

    if (state.current_q && state.q_started_at) {
      return {
        currentQ: Number(state.current_q),
        qStartedAtMs: Number(state.q_started_at)
      };
    }
  } catch {
    // Fall through to Postgres.
  }

  const result = await pool.query<{
    current_q: number;
    q_started_at: string | null;
    status: string;
  }>(
    `
      SELECT current_q, q_started_at, status
      FROM contests
      WHERE id = $1
        AND tenant_id = $2
      LIMIT 1
    `,
    [contestId, tenantId]
  );

  if ((result.rowCount ?? 0) !== 1 || result.rows[0].status !== "live" || !result.rows[0].q_started_at) {
    return null;
  }

  return {
    currentQ: result.rows[0].current_q,
    qStartedAtMs: new Date(result.rows[0].q_started_at).getTime()
  };
}

async function getQuestionData(contestId: string, tenantId: string, seq: number) {
  try {
    const cached = await runRedisWithRetry(() => commandRedis.hgetall(contestQuestionKey(contestId, seq)));

    if (cached.seq) {
      return {
        id: cached.id,
        seq: Number(cached.seq),
        body: cached.body,
        option_a: cached.option_a,
        option_b: cached.option_b,
        option_c: cached.option_c,
        option_d: cached.option_d,
        correct_option: cached.correct_option,
        time_limit_sec: Number(cached.time_limit_sec)
      };
    }
  } catch {
    // Fall back to Postgres.
  }

  const result = await pool.query<{
    id: string;
    seq: number;
    body: string;
    option_a: string;
    option_b: string;
    option_c: string;
    option_d: string;
    correct_option: string;
    time_limit_sec: number;
  }>(
    `
      SELECT id, seq, body, option_a, option_b, option_c, option_d, correct_option, time_limit_sec
      FROM questions q
      JOIN contests c ON c.id = q.contest_id
      WHERE q.contest_id = $1 AND q.seq = $2 AND c.tenant_id = $3
      LIMIT 1
    `,
    [contestId, seq, tenantId]
  );

  if (result.rowCount !== 1) {
    return null;
  }

  return result.rows[0];
}

async function hasAnswered(contestId: string, seq: number, userId: string, tenantId: string) {
  try {
    const alreadyAnswered = await runRedisWithRetry(() =>
      commandRedis.sismember(contestAnsweredKey(contestId, seq), userId)
    );
    return alreadyAnswered === 1;
  } catch {
    const result = await pool.query(
      `
        SELECT 1
        FROM answers a
        JOIN questions q ON q.id = a.question_id
        JOIN contests c ON c.id = a.contest_id
        WHERE a.contest_id = $1
          AND q.seq = $2
          AND a.user_id = $3
          AND c.tenant_id = $4
        LIMIT 1
      `,
      [contestId, seq, userId, tenantId]
    );
    return (result.rowCount ?? 0) > 0;
  }
}

async function getUserScore(contestId: string, userId: string, tenantId: string) {
  try {
    const cached = await runRedisWithRetry(() => commandRedis.hget(contestScoresKey(contestId), userId));
    if (cached !== null) {
      return Number(cached);
    }
  } catch {
    // Fall back to Postgres.
  }

  const result = await pool.query<{ score: string }>(
    `
      SELECT COUNT(*) FILTER (WHERE is_correct = true)::text AS score
      FROM answers a
      JOIN contests c ON c.id = a.contest_id
      WHERE a.contest_id = $1 AND a.user_id = $2 AND c.tenant_id = $3
    `,
    [contestId, userId, tenantId]
  );

  return Number(result.rows[0]?.score ?? "0");
}

function emitContestMessage(message: Record<string, unknown>) {
  const contestId = String(message.contest_id ?? "");
  if (!contestId) {
    return;
  }

  const room = contestRoom(contestId);

  if (message.type === "contest_ended") {
    const winners = (message.winners as Record<string, string> | undefined) ?? {};
    const leaderboard = message.leaderboard ?? [];
    const sockets = io.sockets.adapter.rooms.get(room);

    if (!sockets) {
      return;
    }

    for (const socketId of sockets) {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) {
        continue;
      }

      const userId = (socket.data.user as SocketUser | undefined)?.id;
      const prizeAmount = userId ? winners[userId] ?? "0.00" : "0.00";

      socket.emit("contest_ended", {
        type: "contest_ended",
        contest_id: contestId,
        leaderboard,
        you_won: prizeAmount !== "0.00",
        prize_amount: prizeAmount
      });
    }

    return;
  }

  io.to(room).emit(String(message.type), message);
}

await Promise.all([
  commandRedis.connect(),
  adapterPub.connect(),
  adapterSub.connect(),
  eventSubscriber.connect()
]);

io.adapter(createAdapter(adapterPub, adapterSub));

await eventSubscriber.psubscribe("contest:*");
eventSubscriber.on("pmessage", (_pattern: string, _channel: string, payload: string) => {
  try {
    emitContestMessage(JSON.parse(payload));
  } catch (error) {
    console.error("Failed to process Redis Pub/Sub message", error);
  }
});

io.use(async (socket, next) => {
  try {
    const token = String(socket.handshake.auth.token ?? "");
    const contestId = String(socket.handshake.auth.contest_id ?? "");

    if (!token || !contestId) {
      return next(new Error("Missing token or contest_id"));
    }

    const payload = await verifyToken(token);

    if (payload.isBanned) {
      return next(new Error("User is banned"));
    }

    if (!(await checkContestAccess(contestId, payload.tenantId))) {
      return next(new Error("Contest not found for tenant"));
    }

    socket.data.user = {
      id: payload.userId,
      tenantId: payload.tenantId,
      contestId
    } satisfies SocketUser;

    next();
  } catch (error) {
    next(error as Error);
  }
});

io.on("connection", async (socket) => {
  const user = socket.data.user as SocketUser;
  const room = contestRoom(user.contestId);
  await socket.join(room);

  const state = await getContestState(user.contestId, user.tenantId);
  if (state) {
    const question = await getQuestionData(user.contestId, user.tenantId, state.currentQ);
    const score = await getUserScore(user.contestId, user.id, user.tenantId);
    const timeRemaining = question
      ? Math.max(0, question.time_limit_sec * 1000 - (Date.now() - state.qStartedAtMs))
      : 0;

    socket.emit("reconnected", {
      type: "reconnected",
      current_q: state.currentQ,
      score,
      time_remaining: timeRemaining,
      question: question
        ? {
            seq: question.seq,
            body: question.body,
            option_a: question.option_a,
            option_b: question.option_b,
            option_c: question.option_c,
            option_d: question.option_d,
            time_limit_sec: question.time_limit_sec,
            server_time: state.qStartedAtMs
          }
        : null
    });
  }

  socket.on("submit_answer", async (payload) => {
    try {
      const message = submitAnswerSchema.parse(payload);
      if (message.contest_id !== user.contestId) {
        return socket.emit("error", { type: "error", code: "SERVER_ERROR" });
      }

      const membership = await checkContestMembership(message.contest_id, user.id, user.tenantId);

      if (!membership) {
        return socket.emit("error", { type: "error", code: "NOT_IN_CONTEST" });
      }

      const stateInfo = await getContestState(message.contest_id, user.tenantId);
      if (!stateInfo) {
        return socket.emit("error", { type: "error", code: "SERVER_ERROR" });
      }

      if (stateInfo.currentQ !== message.question_seq) {
        return socket.emit("error", { type: "error", code: "TIME_UP" });
      }

      const question = await getQuestionData(message.contest_id, user.tenantId, message.question_seq);
      if (!question) {
        return socket.emit("error", { type: "error", code: "SERVER_ERROR" });
      }

      const deadline = stateInfo.qStartedAtMs + question.time_limit_sec * 1000;
      if (Date.now() > deadline) {
        return socket.emit("error", { type: "error", code: "TIME_UP" });
      }

      if (await hasAnswered(message.contest_id, message.question_seq, user.id, user.tenantId)) {
        return socket.emit("error", { type: "error", code: "ALREADY_ANSWERED" });
      }

      const isCorrect = message.chosen_option === question.correct_option;
      const insertResult = await pool.query<{ id: string }>(
        `
          INSERT INTO answers (contest_id, question_id, user_id, chosen_option, is_correct)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (question_id, user_id) DO NOTHING
          RETURNING id
        `,
        [message.contest_id, question.id, user.id, message.chosen_option, isCorrect]
      );

      if (insertResult.rowCount !== 1) {
        return socket.emit("error", { type: "error", code: "ALREADY_ANSWERED" });
      }

      try {
        await runRedisWithRetry(() =>
          commandRedis.sadd(contestAnsweredKey(message.contest_id, message.question_seq), user.id)
        );

        if (isCorrect) {
          await runRedisWithRetry(() =>
            commandRedis.hincrby(contestScoresKey(message.contest_id), user.id, 1)
          );
        }
      } catch (redisWriteError) {
        console.error("Redis write failed after answer persisted", {
          contestId: message.contest_id,
          questionSeq: message.question_seq,
          userId: user.id,
          error: redisWriteError instanceof Error ? redisWriteError.message : String(redisWriteError)
        });
        return socket.emit("error", { type: "error", code: "SERVER_ERROR" });
      }

      const yourScore = await getUserScore(message.contest_id, user.id, user.tenantId);
      return socket.emit("answer_result", {
        type: "answer_result",
        is_correct: isCorrect,
        your_score: yourScore
      });
    } catch (error) {
      console.error("submit_answer failed", error);
      socket.emit("error", { type: "error", code: "SERVER_ERROR" });
    }
  });
});

httpServer.listen(gamePort, "0.0.0.0", () => {
  console.log(`Game server listening on ${gamePort}`);
});
