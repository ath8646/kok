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
