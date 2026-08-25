// Postgres local KHÔNG cần Docker (binary nhúng trong node_modules).
// Chạy: npm run db:local  — giữ terminal này, Ctrl+C để dừng. Dữ liệu lưu ở ./.pgdata
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const dataDir = process.env.PGDATA_DIR || "./.pgdata";
const port = Number(process.env.PGPORT || 5432);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "grit",
  password: "grit",
  port,
  persistent: true,
});

const fresh = !existsSync(`${dataDir}/PG_VERSION`);
if (fresh) {
  console.log("Khởi tạo cluster mới tại", dataDir);
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase("grit");
} catch {
  /* đã tồn tại */
}

console.log(`\n✅ Postgres sẵn sàng: postgresql://grit:grit@localhost:${port}/grit`);
console.log("   .env đã trỏ đúng URL này. Giữ terminal này chạy. Ctrl+C để dừng.\n");

process.on("SIGINT", async () => {
  console.log("\nĐang dừng Postgres...");
  await pg.stop();
  process.exit(0);
});

await new Promise<void>(() => {});
