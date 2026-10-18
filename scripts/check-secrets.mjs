// 공개 저장소에 비밀 키가 올라가지 않게 검사한다. 찾으면 실패(exit 1)한다.
// 사용: node scripts/check-secrets.mjs
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PATTERNS = [
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{10,}/],
  ['JWT (service_role 등)', /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ['Google OAuth client secret', /GOCSPX-[A-Za-z0-9_-]{20,}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['GitHub token', /(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/],
  ['Private key', /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Cloudflare API token', /CLOUDFLARE_API_TOKEN\s*[=:]\s*['"]?[A-Za-z0-9_-]{30,}/],
  ['Kakao client secret', /KAKAO_(CLIENT_)?SECRET\s*[=:]\s*['"]?[A-Za-z0-9]{24,}/],
];

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'out', 'build', 'coverage', '.vercel']);
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip)$/i;

function listFiles() {
  try {
    const out = execSync('git ls-files -z --cached --others --exclude-standard', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean);
  } catch {
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (SKIP_DIRS.has(name)) continue;
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk('.');
    return files;
  }
}

let found = 0;
for (const file of listFiles()) {
  if (SKIP_EXT.test(file) || file === 'scripts/check-secrets.mjs') continue;
  let text;
  try {
    if (statSync(file).size > 2_000_000) continue;
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const [name, re] of PATTERNS) {
      if (re.test(line)) {
        found++;
        console.error(`✗ ${file}:${i + 1} — ${name} 처럼 보이는 문자열이 있어요`);
      }
    }
  });
}

if (found) {
  console.error(`\n비밀 키처럼 보이는 문자열 ${found}개를 찾았어요. 지우고 Vercel 환경변수로 옮겨 주세요.`);
  process.exit(1);
}
console.log('✓ 비밀 키처럼 보이는 문자열이 없어요.');
