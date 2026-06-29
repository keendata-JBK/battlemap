const required = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];
const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length) {
  console.error(`缺少生产环境配置：${missing.join(", ")}`);
  console.error("请复制 .env.example 为 .env.production 并填写 Supabase 项目参数。");
  process.exit(1);
}

console.log("生产环境配置检查通过。");
