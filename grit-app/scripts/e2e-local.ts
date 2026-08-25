// E2E tự chứa: dựng Postgres tạm (binary nhúng) → db push → next start → integration → teardown.
// Chạy: npm run test:e2e   (không cần Docker, không đụng .env/dữ liệu thật)
import EmbeddedPostgres from "embedded-postgres";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const PGPORT = 54329;
const APP_PORT = 31000;
const DATABASE_URL = `postgresql://grit:grit@localhost:${PGPORT}/grit`;
const dataDir = "./.pgdata-e2e";

let pg: EmbeddedPostgres | null = null;
let app: ChildProcess | null = null;

async function teardown(code: number) {
  try {
    if (app) app.kill("SIGTERM");
  } catch {}
  try {
    if (pg) await pg.stop();
  } catch {}
  if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
  process.exit(code);
}

async function waitForServer(url: string, ms = 40000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      await fetch(url);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

async function main() {
  if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });

  console.log("① Dựng Postgres tạm (embedded)...");
  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "grit",
    password: "grit",
    port: PGPORT,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("grit");

  console.log("② prisma db push (đồng bộ schema)...");
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL },
  });

  console.log("③ next dev (lấy source mới nhất)...");
  app = spawn("npx", ["next", "dev", "-p", String(APP_PORT)], {
    env: { ...process.env, DATABASE_URL, INTERNAL_CRON_SECRET: "change-me-cron" },
    stdio: "inherit",
  });

  const up = await waitForServer(`http://localhost:${APP_PORT}/api/v1/users/me`);
  if (!up) {
    console.error("✗ Server không lên kịp.");
    return teardown(1);
  }

  console.log("④ Chạy integration...\n");
  const it = spawn("npx", ["tsx", "scripts/integration.ts"], {
    env: {
      ...process.env,
      BASE: `http://localhost:${APP_PORT}/api/v1`,
      INTERNAL_CRON_SECRET: "change-me-cron",
    },
    stdio: "inherit",
  });
  const code: number = await new Promise((res) => it.on("exit", (c) => res(c ?? 1)));
  await teardown(code);
}

main().catch(async (e) => {
  console.error("Lỗi e2e:", e);
  await teardown(1);
});
