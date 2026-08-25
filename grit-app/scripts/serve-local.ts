// Chạy DB nhúng + Next dev trong 1 tiến trình (cho môi trường local không Docker).
// Chạy: npm run serve   → mở http://localhost:3000
import EmbeddedPostgres from "embedded-postgres";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

const PGPORT = Number(process.env.PGPORT || 5432);
const APP_PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = `postgresql://grit:grit@localhost:${PGPORT}/grit`;
const dataDir = process.env.PGDATA_DIR || "./.pgdata";

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "grit",
    password: "grit",
    port: PGPORT,
    persistent: true,
  });

  const fresh = !existsSync(`${dataDir}/PG_VERSION`);
  if (fresh) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase("grit");
  } catch {
    /* đã có */
  }
  console.log("✅ Postgres local sẵn sàng:", DATABASE_URL);

  execSync("npx prisma db push --skip-generate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL },
  });

  if (fresh) {
    console.log("Seed dữ liệu demo...");
    try {
      execSync("npx tsx prisma/seed.ts", {
        stdio: "inherit",
        env: { ...process.env, DATABASE_URL },
      });
    } catch {
      /* bỏ qua nếu seed lỗi */
    }
  }

  const app: ChildProcess = spawn("npx", ["next", "dev", "-p", String(APP_PORT)], {
    env: { ...process.env, DATABASE_URL },
    stdio: "inherit",
  });

  const shutdown = async () => {
    try {
      app.kill("SIGTERM");
    } catch {}
    try {
      await pg.stop();
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise<void>(() => {});
}

main().catch((e) => {
  console.error("Lỗi serve-local:", e);
  process.exit(1);
});
