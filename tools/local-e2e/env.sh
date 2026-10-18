# 앱을 가짜 백엔드에 붙이는 환경변수 (가짜 값이라 공개돼도 괜찮다)
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_fake
export SUPABASE_SECRET_KEY=sb_secret_fake
export ANTHROPIC_API_KEY=fake-key-local
export ANTHROPIC_BASE_URL=http://localhost:54321
export ADMIN_EMAILS=admin@example.com
export CRON_SECRET=local-cron-secret-for-tests-only-123
# 큰 PDF 나누기를 작은 시험 파일로 확인하려고 조각 한도를 아주 작게 둔다 (실제 서비스는 20MB)
export KOK_PDF_PART_MAX_BYTES=12000
export NEXT_TELEMETRY_DISABLED=1
# 카카오 로그인 버튼이 보이는지 시험한다 (가짜 서버라 눌러도 로그인은 되지 않는다)
export NEXT_PUBLIC_KAKAO_LOGIN=1
# 테마 AI 그림: 가짜 Cloudflare (가짜 서버의 /cf). 실제 값은 Vercel 에만 둔다
export CLOUDFLARE_ACCOUNT_ID=0123456789abcdef0123456789abcdef
export CLOUDFLARE_API_TOKEN=fake-cf-token
export CLOUDFLARE_API_BASE=http://localhost:54321/cf
